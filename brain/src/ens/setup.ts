// One-time chain setup on the ENSv2 Sepolia beta, signed by the Sepolia deployer key:
// register <parent>.eth, give it its own Permissioned Resolver and subregistry, issue
// guardian.<parent>.eth with an expiry, hand the policy roles to the Ledger account and the
// two status records to the brain's hot key, then write the policy. Every step checks the
// chain (or the scratch file) first, so re-running after a failure continues where it stopped.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient, createWalletClient, encodeFunctionData, http, toHex, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash, namehash, normalize, packetToBytes } from "viem/ens";
import { generatePrivateKey } from "viem/accounts";
import { ENS, LEDGER_ADDRESS, POLICY_NAME, REPO_ROOT, STATUS_KEYS, type EnsDeployment } from "../config.js";
import { FACTORY_ABI, PR, REGISTRAR_ABI, REGISTRY_ABI, RESOLVER_ABI, RR, USDC_ABI, adm } from "./abi.js";

const PARENT_DURATION_S = 365n * 86_400n;
const CHILD_TTL_S = 30 * 86_400;
const STATE_FILE = resolve(REPO_ROOT, "brain", "state", "ens-setup.json");
export const ENS_DEPLOYMENT_FILE = resolve(REPO_ROOT, "contracts", "deployments", `ens-${ENS.chainId}.json`);

interface SetupState {
  resolver?: `0x${string}`;
  subregistry?: `0x${string}`;
  secret?: Hex;
  commitment?: Hex;
  registered?: boolean;
  childRegistered?: boolean;
  rolesGranted?: boolean;
}

export interface Signer {
  account: ReturnType<typeof privateKeyToAccount>;
  pub: PublicClient;
  wallet: ReturnType<typeof createWalletClient>;
}

export function deployerSigner(rpcUrl: string): Signer {
  const pk = readFileSync(resolve(REPO_ROOT, ".secrets", "sepolia-deployer"), "utf8").trim() as Hex;
  return signerFromKey(rpcUrl, pk);
}

export function signerFromKey(rpcUrl: string, pk: Hex): Signer {
  const account = privateKeyToAccount(pk);
  const transport = http(rpcUrl);
  return {
    account,
    pub: createPublicClient({ chain: sepolia, transport }),
    wallet: createWalletClient({ account, chain: sepolia, transport }),
  };
}

export const dnsName = (name: string): Hex => toHex(packetToBytes(normalize(name)));
export const policyNode = (): Hex => namehash(normalize(POLICY_NAME));

function loadState(): SetupState {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as SetupState) : {};
}
function saveState(s: SetupState): void {
  mkdirSync(resolve(STATE_FILE, ".."), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

interface Call { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }

async function send(s: Signer, log: (l: string) => void, what: string, req: Call): Promise<Hex> {
  const hash = await s.wallet.writeContract({ ...req, account: s.account, chain: sepolia } as never);
  log(`  ${what} → ${hash}`);
  const r = await s.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${what} reverted (${hash})`);
  return hash;
}

async function deployProxy(s: Signer, log: (l: string) => void, impl: `0x${string}`, data: Hex, what: string): Promise<`0x${string}`> {
  const salt = BigInt(generatePrivateKey());
  const sim = await s.pub.simulateContract({
    address: ENS.factory, abi: FACTORY_ABI, functionName: "deployProxy", args: [impl, salt, data], account: s.account,
  });
  await send(s, log, `deploy ${what} proxy`, { address: ENS.factory, abi: FACTORY_ABI, functionName: "deployProxy", args: [impl, salt, data] });
  const verified = await s.pub.readContract({ address: ENS.factory, abi: FACTORY_ABI, functionName: "verifyContract", args: [sim.result] });
  if (verified.toLowerCase() !== impl.toLowerCase()) throw new Error(`${what} proxy at ${sim.result} does not point at ${impl}`);
  return sim.result;
}

export interface SetupOptions {
  brain: `0x${string}`;
  ledger?: `0x${string}`;
  records: Record<string, string>;
  noSubregistry?: boolean;
  log: (line: string) => void;
}

export async function ensSetup(s: Signer, o: SetupOptions): Promise<EnsDeployment> {
  const { log } = o;
  const ledger = o.ledger ?? LEDGER_ADDRESS;
  const parent = `${ENS.parentLabel}.eth`;
  const st = loadState();
  const registrar = { address: ENS.ethRegistrar, abi: REGISTRAR_ABI } as const;

  const [minAge, minDur, available, decimals] = await Promise.all([
    s.pub.readContract({ ...registrar, functionName: "MIN_COMMITMENT_AGE" }),
    s.pub.readContract({ ...registrar, functionName: "MIN_REGISTER_DURATION" }),
    s.pub.readContract({ ...registrar, functionName: "isAvailable", args: [ENS.parentLabel] }),
    s.pub.readContract({ address: ENS.mockUsdc, abi: USDC_ABI, functionName: "decimals" }),
  ]);
  log(`registrar: min commitment age ${minAge}s, min duration ${Number(minDur) / 86400}d, ${parent} ${available ? "available" : "taken"}, USDC decimals ${decimals}`);
  if (PARENT_DURATION_S < minDur) throw new Error("parent duration below the registrar minimum");

  // 1. Resolver proxy (owner: deployer, root roles on every node).
  if (!st.resolver) {
    const init = encodeFunctionData({
      abi: RESOLVER_ABI, functionName: "initialize",
      args: [s.account.address, adm(PR.SET_ADDR | PR.SET_TEXT | PR.SET_CONTENTHASH | PR.SET_NAME | PR.SET_ALIAS | PR.CLEAR | PR.SET_DATA | PR.UPGRADE), []],
    });
    st.resolver = await deployProxy(s, log, ENS.resolverImpl, init, "resolver");
    saveState(st);
  }
  log(`resolver ${st.resolver}`);

  // 2. Subregistry proxy for the parent (holds guardian as a real, expiring name).
  if (!o.noSubregistry && !st.subregistry) {
    const init = encodeFunctionData({
      abi: REGISTRY_ABI, functionName: "initialize",
      args: [s.account.address, adm(RR.REGISTRAR | RR.REGISTER_RESERVED | RR.SET_PARENT | RR.UNREGISTER | RR.RENEW | RR.SET_SUBREGISTRY | RR.SET_RESOLVER | RR.SET_URI | RR.UPGRADE)],
    });
    st.subregistry = await deployProxy(s, log, ENS.userRegistryImpl, init, "subregistry");
    saveState(st);
  }
  const subregistry = (o.noSubregistry ? null : st.subregistry ?? null) as `0x${string}` | null;
  log(`subregistry ${subregistry ?? "none (wildcard on the parent's resolver)"}`);
  const subregistryArg = subregistry ?? ("0x0000000000000000000000000000000000000000" as const);

  // 3. Parent name: commit, wait, register (pays in MockUSDC, minted freely).
  if (!st.registered && available) {
    const [base, premium] = await s.pub.readContract({ ...registrar, functionName: "getRegisterPrice", args: [ENS.parentLabel, PARENT_DURATION_S, ENS.mockUsdc] });
    const price = base + premium;
    log(`price ${Number(price) / 10 ** Number(decimals)} USDC for ${Number(PARENT_DURATION_S) / 86400}d`);
    const [bal, allowance] = await Promise.all([
      s.pub.readContract({ address: ENS.mockUsdc, abi: USDC_ABI, functionName: "balanceOf", args: [s.account.address] }),
      s.pub.readContract({ address: ENS.mockUsdc, abi: USDC_ABI, functionName: "allowance", args: [s.account.address, ENS.ethRegistrar] }),
    ]);
    if (bal < price) await send(s, log, "mint MockUSDC", { address: ENS.mockUsdc, abi: USDC_ABI, functionName: "mint", args: [s.account.address, price] });
    if (allowance < price) await send(s, log, "approve registrar", { address: ENS.mockUsdc, abi: USDC_ABI, functionName: "approve", args: [ENS.ethRegistrar, price] });

    if (!st.secret) { st.secret = generatePrivateKey(); saveState(st); }
    const commitment = await s.pub.readContract({
      ...registrar, functionName: "makeCommitment",
      args: [ENS.parentLabel, s.account.address, st.secret, subregistryArg, st.resolver, PARENT_DURATION_S, ZERO32],
    });
    let at = await s.pub.readContract({ ...registrar, functionName: "commitmentAt", args: [commitment] });
    if (at === 0n) {
      await send(s, log, "commit", { ...registrar, functionName: "commit", args: [commitment] });
      at = await s.pub.readContract({ ...registrar, functionName: "commitmentAt", args: [commitment] });
    }
    st.commitment = commitment; saveState(st);
    for (;;) {
      const now = (await s.pub.getBlock()).timestamp;
      if (now >= at + minAge) break;
      log(`  waiting for the commitment to age (${at + minAge - now}s)`);
      await sleep(10_000);
    }
    await send(s, log, `register ${parent}`, {
      ...registrar, functionName: "register",
      args: [ENS.parentLabel, s.account.address, st.secret, subregistryArg, st.resolver, PARENT_DURATION_S, ENS.mockUsdc, ZERO32],
    });
    st.registered = true; saveState(st);
  } else if (!available) {
    // Registered earlier (by us, or by someone else — the owner check below tells).
    const owner = await s.pub.readContract({ address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "getOwner", args: [BigInt(labelhash(ENS.parentLabel))] });
    if (owner.toLowerCase() !== s.account.address.toLowerCase()) throw new Error(`${parent} is owned by ${owner}, not the deployer`);
    st.registered = true; saveState(st);
    const [res, sub] = await Promise.all([
      s.pub.readContract({ address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "getResolver", args: [ENS.parentLabel] }),
      s.pub.readContract({ address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "getSubregistry", args: [ENS.parentLabel] }),
    ]);
    const id = BigInt(labelhash(ENS.parentLabel));
    if (res.toLowerCase() !== st.resolver.toLowerCase()) await send(s, log, "setResolver on the parent", { address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "setResolver", args: [id, st.resolver] });
    if (sub.toLowerCase() !== subregistryArg.toLowerCase()) await send(s, log, "setSubregistry on the parent", { address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "setSubregistry", args: [id, subregistryArg] });
  }
  log(`${parent} registered to ${s.account.address}`);

  // 4. guardian.<parent>.eth as a real subname with a 30-day expiry (subregistry path only).
  let expiry = 0;
  if (subregistry) {
    const reg = { address: subregistry, abi: REGISTRY_ABI } as const;
    const childId = BigInt(labelhash(ENS.childLabel));
    const existing = await s.pub.readContract({ ...reg, functionName: "getExpiry", args: [childId] });
    if (!st.childRegistered && existing === 0n) {
      await send(s, log, "setParent", { ...reg, functionName: "setParent", args: [ENS.ethRegistry, ENS.parentLabel] });
      expiry = Math.floor(Date.now() / 1000) + CHILD_TTL_S;
      await send(s, log, `register ${POLICY_NAME} (expires in 30d)`, {
        ...reg, functionName: "register",
        args: [ENS.childLabel, s.account.address, "0x0000000000000000000000000000000000000000", st.resolver, adm(RR.RENEW | RR.SET_RESOLVER | RR.SET_SUBREGISTRY | RR.UNREGISTER) | RR.CAN_TRANSFER_ADMIN, BigInt(expiry)],
      });
      st.childRegistered = true; saveState(st);
    } else {
      expiry = Number(existing);
      st.childRegistered = true; saveState(st);
      // A lapsed name stops resolving; a re-run renews it rather than reporting success.
      const now = Number((await s.pub.getBlock()).timestamp);
      if (expiry <= now + 86_400) {
        expiry = now + CHILD_TTL_S;
        await send(s, log, `renew ${POLICY_NAME} (was ${existing === 0n ? "unset" : "expired or expiring"})`, { ...reg, functionName: "renew", args: [childId, BigInt(expiry)] });
      }
    }
    const ledgerRenews = await s.pub.readContract({ ...reg, functionName: "hasRoles", args: [childId, RR.RENEW, ledger] });
    if (!ledgerRenews) await send(s, log, "grant RENEW on guardian to the Ledger", { ...reg, functionName: "grantRoles", args: [childId, RR.RENEW, ledger] });
  }

  // 5. Resolver roles: Ledger edits any text record of the name; the brain edits two.
  if (!st.rolesGranted) {
    const dn = dnsName(POLICY_NAME);
    const rsv = { address: st.resolver, abi: RESOLVER_ABI } as const;
    await send(s, log, "Ledger ← text-record admin on the name", { ...rsv, functionName: "authorizeNameRoles", args: [dn, adm(PR.SET_TEXT), ledger, true] });
    for (const k of STATUS_KEYS) {
      await send(s, log, `brain ← ${k}`, { ...rsv, functionName: "authorizeTextRoles", args: [dn, k, o.brain, true] });
    }
    st.rolesGranted = true; saveState(st);
  }

  // 6. The policy itself.
  await writeRecords(s, st.resolver, o.records, log);

  const out: EnsDeployment = {
    chainId: ENS.chainId, name: POLICY_NAME, node: policyNode(), parent, resolver: st.resolver, subregistry,
    ledger, brain: o.brain, deployer: s.account.address, expiry, commit: ENS.commit,
  };
  writeFileSync(ENS_DEPLOYMENT_FILE, JSON.stringify(out, null, 2) + "\n");
  log(`wrote ${ENS_DEPLOYMENT_FILE}`);
  return out;
}

export async function writeRecords(s: Signer, resolver: `0x${string}`, records: Record<string, string>, log: (l: string) => void): Promise<void> {
  const node = policyNode();
  const calls = Object.entries(records).map(([k, v]) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [node, k, v] }));
  if (calls.length === 1) {
    const [k, v] = Object.entries(records)[0];
    await send(s, log, `setText ${k} = ${v}`, { address: resolver, abi: RESOLVER_ABI, functionName: "setText", args: [node, k, v] });
    return;
  }
  await send(s, log, `setText ×${calls.length} (multicall)`, { address: resolver, abi: RESOLVER_ABI, functionName: "multicall", args: [calls] });
}

// viem spreads a revert over several lines ("reverted with the following signature:" then
// the selector or error name); keep the first three non-empty ones.
export function revertReason(e: unknown): string {
  return (e as Error).message.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" ");
}

const ZERO32 = `0x${"0".repeat(64)}` as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
