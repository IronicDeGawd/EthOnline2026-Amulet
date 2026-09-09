// Secrets come from the Ledger Key Ring: `wallet-cli ring decrypt` at boot, held in memory only.
// Nothing sensitive sits in .env. The machine was provisioned once with the Nano X (`ring init`);
// decrypting afterwards needs no device. Fails closed: no ring, no brain.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "../config.js";

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

function ring(args: string[]): string {
  const pass = walletPass();
  return execFileSync("wallet-cli", ["ring", ...args], {
    encoding: "utf8",
    env: pass ? { ...process.env, WALLET_PASS: pass } : process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

// Decrypts secrets.enc and returns the map. Never logs values.
export function loadSecrets(file = SECRETS_ENC): Secrets {
  if (!existsSync(file)) {
    throw new Error(`no ${file}: run \`amulet secrets seal\` on a machine provisioned with \`wallet-cli ring init\``);
  }
  const plain = ring(["decrypt", "-i", file, "-o", "/dev/stdout", "--key", RING_KEY]);
  const s = parseKv(plain);
  for (const k of ["GRAPH_STUDIO_KEY", "SEPOLIA_RPC_URL", "MAINNET_RPC_URL"]) {
    if (!s[k]) throw new Error(`secret ${k} missing from the ring payload`);
  }
  return s;
}

// Encrypts a plaintext KEY=VALUE file into secrets.enc. Used once per machine.
export function sealSecrets(plainFile: string, out = SECRETS_ENC): void {
  parseKv(readFileSync(plainFile, "utf8")); // validates shape before touching the ring
  ring(["encrypt", "-i", plainFile, "-o", out, "--key", RING_KEY]);
}

export function requireSecret(s: Secrets, k: string): string {
  const v = s[k];
  if (!v) throw new Error(`secret ${k} not set`);
  return v;
}
