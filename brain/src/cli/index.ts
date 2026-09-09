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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { LEDGER_ADDRESS, PENDANT_PORT, REPO_ROOT, loadDeployments } from "../config.js";
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

async function boot(opts: { llm: boolean; port: number; simulate?: string; once?: boolean; deployment?: string }) {
  const s = loadSecrets();
  const dep = loadDeployments();
  const sepolia = sepoliaClient(requireSecret(s, "SEPOLIA_RPC_URL"));
  const mainnet = mainnetClient(requireSecret(s, "MAINNET_RPC_URL"));
  const graph = new GraphClient(requireSecret(s, "GRAPH_STUDIO_KEY"));
  if (s.AWS_PROFILE) process.env.AWS_PROFILE = s.AWS_PROFILE;
  const explainer = opts.llm ? makeNovaExplainer(s.AWS_REGION || "us-east-1") : templateExplainer;
  const recorder = s.BRAIN_LOG_PK ? makeRecorder(requireSecret(s, "SEPOLIA_RPC_URL"), s.BRAIN_LOG_PK as `0x${string}`, dep.amuletLog) : undefined;
  const pendant = new PendantLink();
  await pendant.listen(opts.port);
  log(`listening on ws://${lanIp()}:${opts.port} (firmware AMULET_WSS_URL)`);
  log(`guarding ${LEDGER_ADDRESS} on ${dep.simA}; log key ${recorder?.address ?? "none"}; explainer ${opts.llm ? "nova-lite" : "template"}`);
  const simulate = parseSimulate(opts.simulate, dep) ?? (opts.deployment ? { pinDeployment: opts.deployment } : undefined);
  const brain = new Brain({ sepolia, mainnet, graph, explainer, dep, policy: defaultPolicy(dep), pendant, recorder, log, simulate, once: opts.once });
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
  .action((o) => boot({ llm: o.llm, port: Number(o.port), simulate: o.simulate, once: o.once }));

program.command("propose").description("one proposal, then exit")
  .requiredOption("--simulate <what>", "hf=1.15 | price_drop | util_spike")
  .option("--no-llm").option("--port <n>", "pendant port", String(PENDANT_PORT))
  .action((o) => boot({ llm: o.llm, port: Number(o.port), simulate: o.simulate, once: true }));

program.command("stale").description("pin a wrong deployment so the freshness gate trips")
  .requiredOption("--deployment <Qm>").option("--port <n>", "pendant port", String(PENDANT_PORT))
  .action((o) => boot({ llm: false, port: Number(o.port), deployment: o.deployment }));

program.command("status").description("one round of reads, no pendant").action(async () => {
  const s = loadSecrets();
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
  .action((plain: string) => { sealSecrets(resolve(plain)); console.log("sealed → brain/secrets.enc (delete the plaintext)"); });
secrets.command("check").description("decrypt and list key names only").action(() => {
  console.log(Object.keys(loadSecrets()).join("\n"));
});

program.command("keygen").description("fresh hot key for AmuletLog.record; shown once, paste into the plaintext as BRAIN_LOG_PK")
  .action(() => {
    const pk = generatePrivateKey();
    console.log(`address ${privateKeyToAccount(pk).address}`);
    console.log(`BRAIN_LOG_PK=${pk}`);
  });

program.parseAsync().catch((e) => { console.error(`amulet: ${(e as Error).message}`); process.exit(1); });
