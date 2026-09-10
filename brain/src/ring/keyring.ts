// Secrets come from the Ledger Key Ring: `wallet-cli ring decrypt` at boot, held in memory only.
// Nothing sensitive sits in .env. The machine was provisioned once with the Nano X (`ring init`);
// decrypting afterwards needs no device. Fails closed: no ring, no brain.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../config.js";
import type { Hex } from "viem";

export const RING_KEY = "amulet-brain";
export const SECRETS_ENC = resolve(REPO_ROOT, "brain", "secrets.enc");

export type Secrets = Record<string, string>;

export function parseKv(text: string): Secrets {
  const out: Secrets = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// The ring's member password. Headless runs pass WALLET_PASS; on a Mac it can also sit in
// the login keychain (`security add-generic-password -a default -s ledger-wallet-cli -w`),
// so the password never appears in a shell history or a chat transcript.
function walletPass(): string | undefined {
  if (process.env.WALLET_PASS) return process.env.WALLET_PASS;
  if (process.platform !== "darwin") return undefined;
  try {
    return execFileSync("security", ["find-generic-password", "-a", "default", "-s", "ledger-wallet-cli", "-w"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function ringEnv(): NodeJS.ProcessEnv {
  const pass = walletPass();
  return pass ? { ...process.env, WALLET_PASS: pass } : process.env;
}

// wallet-cli 2.1.0 writes the output file and then never exits (a network handle stays
// open), so the file is watched and the child is killed once it lands.
function ringToFile(args: string[], outFile: string, timeoutMs = 45_000): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // detached: the pnpm shim forks the real process, so the whole group must be killed.
    const child = spawn("wallet-cli", ["ring", ...args, "-o", outFile], { env: ringEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
    let err = "";
    child.stderr.on("data", (b) => { err += b.toString(); });
    child.stdout.on("data", (b) => { err += b.toString(); });
    const started = Date.now();
    const poll = setInterval(() => {
      if (existsSync(outFile)) { finish(); return; }
      if (Date.now() - started > timeoutMs) { finish(new Error(`wallet-cli ring timed out: ${err.trim().split("\n").pop() ?? ""}`)); }
    }, 150);
    child.on("exit", (code) => {
      if (existsSync(outFile)) finish();
      else finish(new Error(`wallet-cli ring exited ${code}: ${err.trim().split("\n").pop() ?? ""}`));
    });
    let done = false;
    function finish(e?: Error) {
      if (done) return;
      done = true;
      clearInterval(poll);
      if (child.exitCode === null && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      e ? reject(e) : resolvePromise();
    }
  });
}

// Decrypts secrets.enc and returns the map. Never logs values.
export async function loadSecrets(file = SECRETS_ENC): Promise<Secrets> {
  if (!existsSync(file)) {
    throw new Error(`no ${file}: run \`amulet secrets seal\` on a machine provisioned with \`wallet-cli ring init\``);
  }
  const dir = mkdtempSync(join(tmpdir(), "amulet-ring-"));
  const out = join(dir, "plain");
  try {
    await ringToFile(["decrypt", "-i", file, "--key", RING_KEY], out);
    const s = parseKv(readFileSync(out, "utf8"));
    for (const k of ["GRAPH_STUDIO_KEY", "SEPOLIA_RPC_URL", "MAINNET_RPC_URL"]) {
      if (!s[k]) throw new Error(`secret ${k} missing from the ring payload`);
    }
    return s;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Encrypts a plaintext KEY=VALUE file into secrets.enc. Used once per machine.
export async function sealSecrets(plainFile: string, out = SECRETS_ENC): Promise<void> {
  parseKv(readFileSync(plainFile, "utf8")); // validates shape before touching the ring
  rmSync(out, { force: true });
  await ringToFile(["encrypt", "-i", plainFile, "--key", RING_KEY], out);
}

// The Sepolia deployer key. It lives inside the Key Ring like everything else, so no key
// that can move funds sits in a file on this machine. The old plaintext at
// .secrets/sepolia-deployer is still read as a fallback and warned about once, so a machine
// that has not been re-sealed yet keeps working.
export function deployerKey(s: Secrets, log: (l: string) => void = () => {}): Hex {
  const sealed = s.SEPOLIA_DEPLOYER_PK;
  if (sealed) return sealed as Hex;
  const file = resolve(REPO_ROOT, ".secrets", "sepolia-deployer");
  if (!existsSync(file)) throw new Error("no deployer key: add SEPOLIA_DEPLOYER_PK to the sealed secrets");
  log(`deployer key read from ${file} in the clear — seal it as SEPOLIA_DEPLOYER_PK and delete the file`);
  return readFileSync(file, "utf8").trim() as Hex;
}

export function requireSecret(s: Secrets, k: string): string {
  const v = s[k];
  if (!v) throw new Error(`secret ${k} not set`);
  return v;
}
