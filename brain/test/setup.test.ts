// ensSetup against a fake chain: which transactions it sends, in what order, and what it
// skips when the chain (or the scratch file) says a step is already done.
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { ENS, POLICY_NAME } from "../src/config.js";
import { ensSetup, type Signer } from "../src/ens/setup.js";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const DEPLOYER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const; // anvil #1, public
const deployer = privateKeyToAccount(DEPLOYER_PK);
const RESOLVER = "0x00000000000000000000000000000000000000aa" as const;
const SUBREG = "0x00000000000000000000000000000000000000bb" as const;
const LEDGER = "0x211828006b402e0aae8244fB95B362b9eFFf7736" as const;
const BRAIN = "0x635DaC6c98435579f90567Dfc510B646Ef1753CA" as const;
const NOW = 1_800_000_000n;

interface ChainState {
  available: boolean;
  owner: `0x${string}`;
  resolver: `0x${string}`;
  subregistry: `0x${string}`;
  childExpiry: bigint;
  commitmentAt: bigint;
  ledgerRenew: boolean;
}

function fakeChain(init: Partial<ChainState> = {}) {
  const state: ChainState = {
    available: true, owner: ZERO, resolver: ZERO, subregistry: ZERO, childExpiry: 0n, commitmentAt: 0n, ledgerRenew: false, ...init,
  };
  const writes: { fn: string; to: string; args: readonly unknown[] }[] = [];
  const proxies = new Map<string, string>(); // proxy → implementation
  const pub = {
    async readContract(r: { address: string; functionName: string; args?: readonly unknown[] }) {
      const a = r.args ?? [];
      switch (r.functionName) {
        case "MIN_COMMITMENT_AGE": return 60n;
        case "MIN_REGISTER_DURATION": return 2_419_200n;
        case "isAvailable": return state.available;
        case "decimals": return 6;
        case "getRegisterPrice": return [8_000_000n, 0n];
        case "balanceOf": return 0n;
        case "allowance": return 0n;
        case "makeCommitment": return `0x${"c".repeat(64)}`;
        case "commitmentAt": return state.commitmentAt;
        case "getOwner": return state.owner;
        case "getResolver": return state.resolver;
        case "getSubregistry": return state.subregistry;
        case "getExpiry": return state.childExpiry;
        case "hasRoles": return state.ledgerRenew;
        case "verifyContract": return proxies.get(String(a[0]).toLowerCase()) ?? ZERO;
        default: throw new Error(`unexpected read ${r.functionName}`);
      }
    },
    async simulateContract(r: { functionName: string; args: readonly unknown[] }) {
      if (r.functionName !== "deployProxy") throw new Error(`unexpected simulate ${r.functionName}`);
      const impl = String(r.args[0]).toLowerCase();
      const proxy = impl === ENS.resolverImpl.toLowerCase() ? RESOLVER : SUBREG;
      proxies.set(proxy.toLowerCase(), impl);
      return { result: proxy };
    },
    async getBlock() { return { timestamp: NOW }; },
    async waitForTransactionReceipt() { return { status: "success" }; },
  };
  const wallet = {
    async writeContract(r: { address: string; functionName: string; args?: readonly unknown[] }) {
      const a = r.args ?? [];
      writes.push({ fn: r.functionName, to: r.address, args: a });
      switch (r.functionName) {
        case "commit": state.commitmentAt = NOW - 61n; break; // aged already: no real wait in tests
        case "register":
          if (a.length === 8) { state.available = false; state.owner = deployer.address; state.subregistry = a[3] as `0x${string}`; state.resolver = a[4] as `0x${string}`; }
          else state.childExpiry = a[5] as bigint;
          break;
        case "renew": state.childExpiry = a[1] as bigint; break;
        case "grantRoles": state.ledgerRenew = true; break;
        case "setResolver": state.resolver = a[1] as `0x${string}`; break;
        case "setSubregistry": state.subregistry = a[1] as `0x${string}`; break;
      }
      return `0x${writes.length.toString(16).padStart(64, "0")}`;
    },
  };
  const signer = { account: deployer, pub, wallet } as unknown as Signer;
  return { signer, writes, state };
}

const records = { "amulet.version": "1", "amulet.chain": "11155111", "amulet.status": "offline" };
let dir: string;
let paths: { state: string; deployment: string };
const quiet = () => {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "amulet-ens-"));
  paths = { state: join(dir, "state.json"), deployment: join(dir, "ens.json") };
});

describe("ensSetup from nothing", () => {
  it("deploys proxies, registers parent and child, grants roles, writes records, saves the deployment", async () => {
    const { signer, writes, state } = fakeChain();
    const out = await ensSetup(signer, { brain: BRAIN, ledger: LEDGER, records, log: quiet, paths });
    expect(writes.map((w) => w.fn)).toEqual([
      "deployProxy", "deployProxy", "mint", "approve", "commit", "register",
      "setParent", "register", "grantRoles", "authorizeNameRoles", "authorizeTextRoles", "authorizeTextRoles", "multicall",
    ]);
    const parentReg = writes[5];
    expect(parentReg.args[3]).toBe(SUBREG);   // commitment and register carry the proxies
    expect(parentReg.args[4]).toBe(RESOLVER);
    expect(parentReg.args[5]).toBe(365n * 86_400n);
    const childReg = writes[7];
    expect(childReg.to).toBe(SUBREG);
    expect(childReg.args[0]).toBe("guardian");
    expect(childReg.args[3]).toBe(RESOLVER);
    expect(writes[8].args[2]).toBe(LEDGER);   // RENEW to the Ledger
    expect(writes[9].args[2]).toBe(LEDGER);   // text admin to the Ledger
    expect(writes[10].args[1]).toBe("amulet.status");
    expect(writes[10].args[2]).toBe(BRAIN);
    expect(writes[11].args[1]).toBe("amulet.last-action");
    expect(out.resolver).toBe(RESOLVER);
    expect(out.subregistry).toBe(SUBREG);
    expect(out.name).toBe(POLICY_NAME);
    expect(out.expiry).toBe(Number(state.childExpiry));
    expect(JSON.parse(readFileSync(paths.deployment, "utf8")).ledger).toBe(LEDGER);
    expect(existsSync(paths.state)).toBe(true);
  });

  it("without a subregistry registers the parent with a zero subregistry and skips the child", async () => {
    const { signer, writes } = fakeChain();
    const out = await ensSetup(signer, { brain: BRAIN, ledger: LEDGER, records, log: quiet, paths, noSubregistry: true });
    expect(writes.filter((w) => w.fn === "deployProxy")).toHaveLength(1);
    expect(writes.find((w) => w.fn === "register")!.args[3]).toBe(ZERO);
    expect(writes.map((w) => w.fn)).not.toContain("setParent");
    expect(writes.map((w) => w.fn)).not.toContain("grantRoles");
    expect(out.subregistry).toBeNull();
    expect(out.expiry).toBe(0);
  });
});

describe("ensSetup again", () => {
  const done = { resolver: RESOLVER, subregistry: SUBREG, secret: `0x${"5".repeat(64)}`, registered: true, childRegistered: true, rolesGranted: true };

  it("only rewrites the records when everything is already on chain", async () => {
    writeFileSync(paths.state, JSON.stringify(done));
    const { signer, writes } = fakeChain({ available: false, owner: deployer.address, resolver: RESOLVER, subregistry: SUBREG, childExpiry: NOW + 20n * 86_400n, ledgerRenew: true });
    await ensSetup(signer, { brain: BRAIN, ledger: LEDGER, records, log: quiet, paths });
    expect(writes.map((w) => w.fn)).toEqual(["multicall"]);
  });

  it("renews a lapsed guardian instead of calling it done", async () => {
    writeFileSync(paths.state, JSON.stringify(done));
    const { signer, writes, state } = fakeChain({ available: false, owner: deployer.address, resolver: RESOLVER, subregistry: SUBREG, childExpiry: NOW - 5n, ledgerRenew: true });
    const out = await ensSetup(signer, { brain: BRAIN, ledger: LEDGER, records, log: quiet, paths });
    expect(writes.map((w) => w.fn)).toEqual(["renew", "multicall"]);
    expect(state.childExpiry).toBe(NOW + 30n * 86_400n);
    expect(out.expiry).toBe(Number(NOW + 30n * 86_400n));
  });

  it("repairs a parent whose resolver or subregistry drifted", async () => {
    writeFileSync(paths.state, JSON.stringify(done));
    const { signer, writes } = fakeChain({ available: false, owner: deployer.address, resolver: ZERO, subregistry: ZERO, childExpiry: NOW + 20n * 86_400n, ledgerRenew: true });
    await ensSetup(signer, { brain: BRAIN, ledger: LEDGER, records, log: quiet, paths });
    expect(writes.map((w) => w.fn)).toEqual(["setResolver", "setSubregistry", "multicall"]);
  });

  it("refuses to touch a parent someone else owns", async () => {
    const { signer } = fakeChain({ available: false, owner: "0x000000000000000000000000000000000000dEaD" });
    await expect(ensSetup(signer, { brain: BRAIN, ledger: LEDGER, records, log: quiet, paths })).rejects.toThrow(/owned by 0x000000000000000000000000000000000000dEaD/);
  });

  it("re-grants the Ledger's renew role if it went missing", async () => {
    writeFileSync(paths.state, JSON.stringify(done));
    const { signer, writes } = fakeChain({ available: false, owner: deployer.address, resolver: RESOLVER, subregistry: SUBREG, childExpiry: NOW + 20n * 86_400n, ledgerRenew: false });
    await ensSetup(signer, { brain: BRAIN, ledger: LEDGER, records, log: quiet, paths });
    expect(writes.map((w) => w.fn)).toEqual(["grantRoles", "multicall"]);
  });
});
