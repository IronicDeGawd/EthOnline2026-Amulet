#!/usr/bin/env tsx
// amulet — run the brain, or poke it.
//   amulet run [--simulate hf=1.15|price_drop|util_spike] [--once] [--no-llm] [--port 8788]
//   amulet propose --simulate hf=1.15       (= run --once)
//   amulet stale --deployment Qm…           (pins a wrong deployment: freshness gate trips)
//   amulet status                           (one tick of reads, no pendant)
//   amulet secrets seal <plain.txt>         (encrypt with the Ledger Key Ring)
//   amulet keygen                           (fresh hot key for AmuletLog, printed once)
import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ENS, LEDGER_ADDRESS, PENDANT_PORT, POLICY_KEYS, POLICY_NAME, REPO_ROOT, STATUS_KEYS, loadDeployments, loadEnsDeployment } from "../config.js";
import { deployerSigner, ensSetup, revertReason, signerFromKey, writeRecords } from "../ens/setup.js";
import { readPolicy, readRecords, type PolicyRead } from "../ens/resolver.js";
import { makeStatusWriter, type StatusWriter } from "../ens/status.js";
import { formatView, readMainnetView } from "../chain/account.js";
import { runAttack, type AttackKind } from "../attack.js";
import { fetchYieldTable, formatTable, YIELD_ASSET } from "../data/graph/yield.js";
import { RESOLVER_ABI } from "../ens/abi.js";
import { policyRecords } from "../engine/policy.js";
import { loadSecrets, requireSecret, sealSecrets } from "../ring/keyring.js";
import { GraphClient } from "../data/graph/client.js";
import { fetchLending, pickMarket } from "../data/graph/lending.js";
import { checkFreshness } from "../data/graph/freshness.js";
import { headBlock, mainnetClient, sepoliaClient } from "../chain/sepolia.js";
import { readPosition } from "../chain/positionsim.js";
import { makeRecorder } from "../chain/amuletlog.js";
import { defaultPolicy } from "../engine/policy.js";
import { makeNovaExplainer, templateExplainer } from "../engine/llm.js";
import { PendantLink } from "../pendant/ws.js";
import { Brain, type Simulation } from "../brain.js";

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return "127.0.0.1";
}

function parseSimulate(s?: string, dep = loadDeployments()): Simulation | undefined {
  if (!s) return undefined;
  if (s.startsWith("hf=")) return { hf: Number(s.slice(3)) };
  if (s === "util_spike") return { utilSpike: true };
  if (s === "price_drop") { priceDrop(dep.simA, 1600_00000000n); return undefined; }
  throw new Error(`unknown --simulate ${s}`);
}

// Testnet lever, not a brain secret: setPrice from the deployer key so the real HF drops.
function priceDrop(sim: string, price: bigint): void {
  const keyFile = resolve(REPO_ROOT, ".secrets", "sepolia-deployer");
  const key = readFileSync(keyFile, "utf8").trim();
  const rpc = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  log(`setPrice(${price}) on ${sim} from the deployer key`);
  const out = execFileSync("cast", ["send", sim, "setPrice(uint256)", price.toString(), "--private-key", key, "--rpc-url", rpc, "--json"], { encoding: "utf8" });
  log(`  tx ${JSON.parse(out).transactionHash}`);
}

async function boot(opts: { llm: boolean; port: number; simulate?: string; once?: boolean; deployment?: string; ens?: boolean }) {
  const s = await loadSecrets();
  const dep = loadDeployments();
  const rpc = requireSecret(s, "SEPOLIA_RPC_URL");
  const sepolia = sepoliaClient(rpc);
  const mainnet = mainnetClient(requireSecret(s, "MAINNET_RPC_URL"));
  const graph = new GraphClient(requireSecret(s, "GRAPH_STUDIO_KEY"));
  if (s.AWS_PROFILE) process.env.AWS_PROFILE = s.AWS_PROFILE;
  const explainer = opts.llm ? makeNovaExplainer(s.AWS_REGION || "us-east-1") : templateExplainer;
  const recorder = s.BRAIN_LOG_PK ? makeRecorder(rpc, s.BRAIN_LOG_PK as `0x${string}`, dep.amuletLog) : undefined;

  // Policy: from ENS unless told otherwise. Without the name there is no policy to enforce,
  // so a failed read at boot stops the brain rather than quietly running on defaults.
  let policy = defaultPolicy(dep);
  let policySource: (() => Promise<PolicyRead>) | undefined;
  let status: StatusWriter | undefined;
  if (opts.ens !== false) {
    policySource = () => readPolicy(sepolia, POLICY_NAME, defaultPolicy(dep));
    const first = await policySource();
    policy = first.policy;
    log(`policy from ${first.name}: v${policy.version} chain ${policy.chain}, ${policy.allowed.length} targets, cap ${Number(policy.max_value_wei) / 1e18} ETH, tiers ${policy.tier1_hf}/${policy.tier2_hf}`);
    if (s.BRAIN_LOG_PK) {
      const ensDep = loadEnsDeployment();
      status = makeStatusWriter({ rpcUrl: rpc, pk: s.BRAIN_LOG_PK as `0x${string}`, resolver: ensDep.resolver, node: ensDep.node, log });
    }
  } else {
    log("policy: built-in defaults (--no-ens); nothing on the wrist will match a changed ENS record");
  }
  const mainnetView = async () => formatView(await readMainnetView(mainnet));

  const pendant = new PendantLink();
  await pendant.listen(opts.port);
  log(`listening on ws://${lanIp()}:${opts.port} (firmware AMULET_WSS_URL)`);
  log(`guarding ${LEDGER_ADDRESS} on ${dep.simA}; log key ${recorder?.address ?? "none"}; explainer ${opts.llm ? "nova-lite" : "template"}`);
  const simulate = parseSimulate(opts.simulate, dep) ?? (opts.deployment ? { pinDeployment: opts.deployment } : undefined);
  const brain = new Brain({ sepolia, mainnet, graph, explainer, dep, policy, pendant, recorder, policySource, status, mainnetView, log, simulate, once: opts.once });
  process.on("SIGINT", () => { brain.stop(); pendant.close(); process.exit(0); });
  await brain.run();
  pendant.close();
}

const program = new Command().name("amulet").description("The brain behind the Amulet pendant");

program.command("run").description("watch, propose, record")
  .option("--simulate <what>", "hf=1.15 | price_drop | util_spike")
  .option("--once", "stop after the first decision")
  .option("--no-llm", "template text instead of Nova Lite")
  .option("--port <n>", "pendant port", String(PENDANT_PORT))
  .option("--no-ens", "built-in policy instead of the ENS records")
  .action((o) => boot({ llm: o.llm, port: Number(o.port), simulate: o.simulate, once: o.once, ens: o.ens }));

program.command("propose").description("one proposal, then exit")
  .requiredOption("--simulate <what>", "hf=1.15 | price_drop | util_spike")
  .option("--no-llm").option("--port <n>", "pendant port", String(PENDANT_PORT))
  .option("--no-ens", "built-in policy instead of the ENS records")
  .action((o) => boot({ llm: o.llm, port: Number(o.port), simulate: o.simulate, once: true, ens: o.ens }));

program.command("stale").description("pin a wrong deployment so the freshness gate trips")
  .requiredOption("--deployment <Qm>").option("--port <n>", "pendant port", String(PENDANT_PORT))
  .action((o) => boot({ llm: false, port: Number(o.port), deployment: o.deployment }));

program.command("status").description("one round of reads, no pendant").action(async () => {
  const s = await loadSecrets();
  const dep = loadDeployments();
  const sepolia = sepoliaClient(requireSecret(s, "SEPOLIA_RPC_URL"));
  const mainnet = mainnetClient(requireSecret(s, "MAINNET_RPC_URL"));
  const graph = new GraphClient(requireSecret(s, "GRAPH_STUDIO_KEY"));
  const [head, lending] = await Promise.all([headBlock(mainnet), fetchLending(graph, "aaveV3")]);
  const fresh = checkFreshness("aaveV3", lending.meta, head, lending.queriedAt);
  const weth = pickMarket(lending.markets, "WETH");
  console.log(JSON.stringify({ head, fresh, weth }, null, 2));
  for (const sim of [dep.simA, dep.simB]) {
    const p = await readPosition(sepolia, sim, LEDGER_ADDRESS);
    console.log(`${p.name}: HF ${p.healthFactor} coll ${p.collateralWei} wei debt ${p.debtUnits} price ${p.price}`);
  }
});

const secrets = program.command("secrets").description("Ledger Key Ring wrapped secrets");
secrets.command("seal").argument("<plain>", "KEY=VALUE file").description("encrypt into brain/secrets.enc")
  .action(async (plain: string) => { await sealSecrets(resolve(plain)); console.log("sealed → brain/secrets.enc (delete the plaintext)"); });
secrets.command("check").description("decrypt and list key names only").action(async () => {
  console.log(Object.keys(await loadSecrets()).join("\n"));
});

program.command("yield").description("where this asset earns the most right now: one lending query across Aave, Compound and Spark")
  .option("--asset <symbol>", "asset to rank", YIELD_ASSET)
  .action(async (o) => {
    const s = await loadSecrets();
    const graph = new GraphClient(requireSecret(s, "GRAPH_STUDIO_KEY"));
    const mainnet = mainnetClient(requireSecret(s, "MAINNET_RPC_URL"));
    const t = await fetchYieldTable(graph, mainnet, String(o.asset).toUpperCase());
    console.log(`${t.asset} supply rates, mainnet head ${t.head}`);
    for (const l of formatTable(t)) console.log(`  ${l}`);
    if (t.rows.length >= 2) {
      const [best, ...rest] = t.rows;
      const cur = rest.find((r) => r.protocol === "Aave") ?? rest[0];
      const delta = best.supplyRateBps - (cur?.supplyRateBps ?? best.supplyRateBps);
      console.log(`  best ${best.protocol} over ${cur?.protocol}: +${delta} bps`);
    }
  });

program.command("attack").description("play a compromised brain: push an out-of-policy proposal, or try to raise the limit on ENS")
  .option("--value <eth>", "allowed call with this much ETH attached (over the cap)")
  .option("--target <addr>", "plain transfer to an address the policy never listed")
  .option("--raise-limit", "brain hot key tries setText(amulet.max_value_wei)")
  .option("--port <n>", "pendant port", String(PENDANT_PORT))
  .action(async (o) => {
    const s = await loadSecrets();
    const dep = loadDeployments();
    const rpc = requireSecret(s, "SEPOLIA_RPC_URL");
    const sepolia = sepoliaClient(rpc);
    if (o.raiseLimit) {
      const d = loadEnsDeployment();
      const signer = signerFromKey(rpc, requireSecret(s, "BRAIN_LOG_PK") as `0x${string}`);
      log(`brain hot key ${signer.account.address} tries to raise amulet.max_value_wei to 5 ETH`);
      try {
        await writeRecords(signer, d.resolver, { "amulet.max_value_wei": "5000000000000000000" }, log);
        log("WRITTEN — the roles are wrong, fix the setup");
        process.exitCode = 1;
      } catch (e) {
        log(`refused by the resolver: ${revertReason(e)}`);
      }
      return;
    }
    if (o.target && !isAddress(o.target)) throw new Error(`--target ${o.target} is not an address`);
    if (o.value && !/^\d+(\.\d+)?$/.test(o.value)) throw new Error(`--value ${o.value} is not an ETH amount`);
    const kind: AttackKind = o.target
      ? { kind: "target", to: o.target as `0x${string}` }
      : { kind: "value", eth: (o.value as string | undefined) ?? "5" };
    const policy = (await readPolicy(sepolia, POLICY_NAME, defaultPolicy(dep))).policy;
    const recorder = s.BRAIN_LOG_PK ? makeRecorder(rpc, s.BRAIN_LOG_PK as `0x${string}`, dep.amuletLog) : undefined;
    const pendant = new PendantLink();
    await pendant.listen(Number(o.port));
    log(`listening on ws://${lanIp()}:${o.port}; waiting for the pendant`);
    await new Promise<void>((r) => { if (pendant.connected) r(); else pendant.once("connected", () => r()); });
    let ledger = LEDGER_ADDRESS as `0x${string}`;
    pendant.on("presence", (p) => { if (p.address) ledger = p.address as `0x${string}`; });
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await runAttack({ sepolia, dep, policy, ledger, pendant, recorder, log }, kind);
    } finally {
      pendant.close();
    }
  });

const ens = program.command("ens").description("policy on ENSv2 Sepolia: setup, show, edit");
ens.command("setup").description("register the name, deploy resolver + subregistry, grant roles, write the policy (deployer key)")
  .option("--no-subregistry", "keep guardian's records on the parent's resolver only")
  .option("--endpoint <url>", "amulet.endpoint record", `ws://${lanIp()}:${PENDANT_PORT}`)
  .action(async (o) => {
    const s = await loadSecrets();
    const dep = loadDeployments();
    const brain = privateKeyToAccount(requireSecret(s, "BRAIN_LOG_PK") as `0x${string}`).address;
    const records = {
      ...policyRecords(defaultPolicy(dep)),
      "amulet.brain": brain,
      "amulet.endpoint": o.endpoint as string,
      "amulet.status": "offline",
    };
    const signer = deployerSigner(requireSecret(s, "SEPOLIA_RPC_URL"));
    log(`deployer ${signer.account.address}, brain ${brain}, ledger ${LEDGER_ADDRESS}`);
    const out = await ensSetup(signer, { brain, records, noSubregistry: !o.subregistry, log });
    log(`${out.name} → resolver ${out.resolver}${out.subregistry ? `, subregistry ${out.subregistry}` : ""}`);
    await showEns(sepoliaClient(requireSecret(s, "SEPOLIA_RPC_URL")));
  });
ens.command("show").description("records as any wallet reads them, plus who may edit what").action(async () => {
  const s = await loadSecrets();
  await showEns(sepoliaClient(requireSecret(s, "SEPOLIA_RPC_URL")));
});
ens.command("set").description("edit one policy record (deployer standing in for the Ledger's role)")
  .argument("<key>").argument("<value>")
  .action(async (key: string, value: string) => {
    const s = await loadSecrets();
    const d = loadEnsDeployment();
    const k = key.startsWith("amulet.") ? key : `amulet.${key}`;
    await writeRecords(deployerSigner(requireSecret(s, "SEPOLIA_RPC_URL")), d.resolver, { [k]: value }, log);
  });
ens.command("status").description("write amulet.status (or --key) with the brain hot key; anything but its two records reverts")
  .argument("<value>").option("--key <k>", "record", "amulet.status")
  .action(async (value: string, o) => {
    const s = await loadSecrets();
    const d = loadEnsDeployment();
    const signer = signerFromKey(requireSecret(s, "SEPOLIA_RPC_URL"), requireSecret(s, "BRAIN_LOG_PK") as `0x${string}`);
    try {
      await writeRecords(signer, d.resolver, { [o.key]: value }, log);
    } catch (e) {
      log(`refused: ${revertReason(e)}`);
      process.exitCode = 1;
    }
  });

async function showEns(client: ReturnType<typeof sepoliaClient>): Promise<void> {
  const keys = [...POLICY_KEYS, ...STATUS_KEYS, "amulet.brain", "amulet.endpoint"];
  const rec = await readRecords(client, keys);
  console.log(`${POLICY_NAME} (ENSv2 Sepolia, contracts-v2 @ ${ENS.commit.slice(0, 7)})`);
  for (const k of keys) console.log(`  ${k.padEnd(28)} ${rec[k] ?? "(unset)"}`);
  let d: ReturnType<typeof loadEnsDeployment> | undefined;
  try {
    d = loadEnsDeployment();
  } catch (e) {
    console.error(`could not load ENS deployment file: ${(e as Error).message.split("\n")[0]}`);
    return;
  }
  const can = async (who: `0x${string}`, key: string) => {
    try {
      await client.simulateContract({ address: d!.resolver, abi: RESOLVER_ABI, functionName: "setText", args: [d!.node, key, "probe"], account: who });
      return "yes";
    } catch { return "no"; } // a revert is the answer here, not an error
  };
  console.log(`  resolver ${d.resolver}${d.subregistry ? `  subregistry ${d.subregistry}` : ""}${d.expiry ? `  expires ${new Date(d.expiry * 1000).toISOString().slice(0, 10)}` : ""}`);
  for (const [label, who] of [["ledger", d.ledger], ["brain", d.brain], ["deployer", d.deployer]] as const) {
    const [pol, st] = await Promise.all([can(who, "amulet.max_value_wei"), can(who, "amulet.status")]);
    console.log(`  ${label.padEnd(9)} ${who}  edit policy: ${pol}  write status: ${st}`);
  }
}

program.command("keygen").description("fresh hot key for AmuletLog.record; shown once, paste into the plaintext as BRAIN_LOG_PK")
  .action(() => {
    const pk = generatePrivateKey();
    console.log(`address ${privateKeyToAccount(pk).address}`);
    console.log(`BRAIN_LOG_PK=${pk}`);
  });

program.parseAsync().catch((e) => { console.error(`amulet: ${(e as Error).message}`); process.exit(1); });
