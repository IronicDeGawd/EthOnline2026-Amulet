#!/usr/bin/env tsx
// amulet — run the brain, or poke it.
//   amulet run [--simulate hf=1.15|price_drop|util_spike] [--once] [--no-llm] [--port 8788]
//   amulet propose --simulate hf=1.15       (= run --once)
//   amulet stale --deployment Qm…           (pins a wrong deployment: freshness gate trips)
//   amulet status                           (one tick of reads, no pendant)
//   amulet secrets seal <plain.txt>         (encrypt with the Ledger Key Ring)
//   amulet keygen                           (fresh hot key for AmuletLog, printed once)
import { Command } from "commander";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { isAddress, parseAbi, parseEther, toHex, type Hex } from "viem";
import { ulid } from "ulid";
import { namehash, normalize } from "viem/ens";
import { sepolia as sepoliaChain } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AGENTS, ENS, LEDGER_ADDRESS, PENDANT_PORT, REPO_ROOT, SEPOLIA_CHAIN_ID, POLICY_KEYS, POLICY_NAME, STATUS_KEYS, DEFAULT_AGENT, agentName, loadDeployments, loadEnsDeployment, type AgentKey, type Deployments } from "../config.js";
import { deployerSigner, ensSetup, issueAgent, revertReason, revokeAgent, signerFromKey, writeRecords } from "../ens/setup.js";
import { FACES, faceAvatar, faceRecord } from "../agents/face.js";
import { readPolicy, readRecords, type PolicyRead } from "../ens/resolver.js";
import { makeStatusWriter, type StatusWriter } from "../ens/status.js";
import { formatView, readMainnetView } from "../chain/account.js";
import { accountBalance, accountNonce, makeRelayer, type Relayer } from "../chain/account712.js";
import { runAttack, type AttackKind } from "../attack.js";
import { MENU, runScenario, type DemoDeps } from "./demo.js";
import { fetchYieldTable, formatTable, YIELD_ASSET } from "../data/graph/yield.js";
import { RESOLVER_ABI } from "../ens/abi.js";
import { agentPolicy, policyRecords } from "../engine/policy.js";
import { deployerKey, loadSecrets, requireSecret, sealSecrets } from "../ring/keyring.js";
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

async function parseSimulate(s: string | undefined, dep: Deployments, rpc: string, key: Hex): Promise<Simulation | undefined> {
  if (!s) return undefined;
  if (s.startsWith("hf=")) return { hf: Number(s.slice(3)) };
  if (s === "util_spike") return { utilSpike: true };
  if (s === "yield") return { yield: true };
  if (s === "price_drop") { await setPrice(dep.simA, 1600_00000000n, rpc, key); return undefined; }
  throw new Error(`unknown --simulate ${s}`);
}

// Testnet lever, not a brain secret: setPrice so the real HF drops. Signed in process with
// the sealed deployer key, never handed to another program on a command line.
async function setPrice(sim: `0x${string}`, price: bigint, rpc: string, key: Hex): Promise<void> {
  const signer = signerFromKey(rpc, key);
  log(`setPrice(${price}) on ${sim} from the deployer key`);
  const hash = await signer.wallet.writeContract({
    address: sim, abi: parseAbi(["function setPrice(uint256)"]), functionName: "setPrice", args: [price],
    account: signer.account, chain: sepoliaChain,
  });
  await signer.pub.waitForTransactionReceipt({ hash });
  log(`  tx ${hash}`);
}

async function boot(opts: { llm: boolean; port: number; simulate?: string; once?: boolean; deployment?: string; ens?: boolean; raw?: boolean; agent?: string }) {
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
  // The brain runs AS a named agent, and reads its limits from its own name. Two agents on
  // the same machine read different names and are held to different caps.
  const agent = (opts.agent ?? DEFAULT_AGENT) as AgentKey;
  if (!AGENTS[agent]) throw new Error(`unknown agent ${agent}; known: ${Object.keys(AGENTS).join(", ")}`);
  const myName = agentName(AGENTS[agent].label);
  let policy = agentPolicy(agent, dep);
  let policySource: (() => Promise<PolicyRead>) | undefined;
  let status: StatusWriter | undefined;
  if (opts.ens !== false) {
    policySource = () => readPolicy(sepolia, myName, agentPolicy(agent, dep));
    const first = await policySource();
    policy = first.policy;
    log(`running as ${AGENTS[agent].title} (${myName})`);
    log(`policy from ${first.name}: v${policy.version} chain ${policy.chain}, ${policy.allowed.length} targets, cap ${Number(policy.max_value_wei) / 1e18} ETH, tiers ${policy.tier1_hf}/${policy.tier2_hf}`);
    if (s.BRAIN_LOG_PK) {
      const ensDep = loadEnsDeployment();
      status = makeStatusWriter({ rpcUrl: rpc, pk: s.BRAIN_LOG_PK as `0x${string}`, resolver: ensDep.resolver, node: namehash(normalize(myName)), log });
    }
  } else {
    log("policy: built-in defaults (--no-ens); nothing on the wrist will match a changed ENS record");
  }
  const mainnetView = async () => formatView(await readMainnetView(mainnet));
  const yieldSource = () => fetchYieldTable(graph, mainnet, YIELD_ASSET);

  // Typed data: the Ledger reads the intent instead of blind-signing bytes. The account holds
  // the position; this process only carries the signature and pays the gas.
  // Typed data unless asked for the raw path: the device reading the action in words is the
  // better default now that it works, and nothing about the policy check changes either way.
  let relayer: Relayer | undefined;
  if (!opts.raw && dep.amuletAccount && s.BRAIN_LOG_PK) {
    relayer = makeRelayer(rpc, s.BRAIN_LOG_PK as `0x${string}`);
    const [n, bal] = await Promise.all([accountNonce(sepolia, dep.amuletAccount), accountBalance(sepolia, dep.amuletAccount)]);
    log(`clear signing on: account ${dep.amuletAccount} nonce ${n} balance ${Number(bal) / 1e18} ETH, relayed by ${relayer.address}`);
    log("the Nano X needs \"Verbose EIP712\" on in the Ethereum app, or it shows the domain and a hash");
  } else if (opts.raw) {
    log("raw transactions: the Nano X will blind-sign the calldata");
  }

  const pendant = new PendantLink();
  await pendant.listen(opts.port);
  log(`listening on ws://${lanIp()}:${opts.port} (firmware AMULET_WSS_URL)`);
  log(`guarding ${LEDGER_ADDRESS} on ${dep.simA}; log key ${recorder?.address ?? "none"}; explainer ${opts.llm ? "nova-lite" : "template"}`);
  const simulate = (await parseSimulate(opts.simulate, dep, rpc, deployerKey(s, log))) ?? (opts.deployment ? { pinDeployment: opts.deployment } : undefined);
  const brain = new Brain({ sepolia, mainnet, graph, explainer, dep, policy, pendant, recorder, policySource, status, mainnetView, yieldSource, relayer, agent: AGENTS[agent].label, log, simulate, once: opts.once });
  process.on("SIGINT", () => { brain.stop(); pendant.close(); process.exit(0); });
  await brain.run();
  pendant.close();
}

const program = new Command().name("amulet").description("The brain behind the Amulet pendant");

program.command("run").description("watch, propose, record")
  .option("--simulate <what>", "hf=1.15 | price_drop | util_spike | yield")
  .option("--once", "stop after the first decision")
  .option("--no-llm", "template text instead of Nova Lite")
  .option("--port <n>", "pendant port", String(PENDANT_PORT))
  .option("--no-ens", "built-in policy instead of the ENS records")
  .option("--raw", "blind-sign a transaction instead of a typed-data intent")
  .option("--agent <name>", "which named agent to run as", DEFAULT_AGENT)
  .action((o) => boot({ llm: o.llm, port: Number(o.port), simulate: o.simulate, once: o.once, ens: o.ens, raw: o.raw, agent: o.agent }));

program.command("propose").description("one proposal, then exit")
  .requiredOption("--simulate <what>", "hf=1.15 | price_drop | util_spike | yield")
  .option("--no-llm").option("--port <n>", "pendant port", String(PENDANT_PORT))
  .option("--no-ens", "built-in policy instead of the ENS records")
  .option("--raw", "blind-sign a transaction instead of a typed-data intent")
  .option("--agent <name>", "which named agent to run as", DEFAULT_AGENT)
  .action((o) => boot({ llm: o.llm, port: Number(o.port), simulate: o.simulate, once: true, ens: o.ens, raw: o.raw, agent: o.agent }));

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

// forge and cast want a raw key on the command line. This unseals it for exactly that, to
// stdout only, with a warning on stderr — never paste the output anywhere.
program.command("key").description("print a key from the ring for a one-off forge/cast run")
  .argument("<which>", "deployer")
  .action(async (which: string) => {
    if (which !== "deployer") throw new Error(`unknown key ${which}`);
    const s = await loadSecrets();
    process.stderr.write("this is a private key: use it in this command only, never paste it\n");
    process.stdout.write(deployerKey(s));
  });

program.command("setprice").description("testnet lever: move the sim's price so a rule fires (deployer key, from the ring)")
  .argument("<price>", "8-decimal price, e.g. 110000000000 for $1100")
  .option("--sim <b>", "simA | simB", "simA")
  .action(async (price: string, o) => {
    if (!/^\d+$/.test(price)) throw new Error(`${price} is not a price`);
    const s = await loadSecrets();
    const dep = loadDeployments();
    const sim = o.sim === "simB" ? dep.simB : dep.simA;
    await setPrice(sim, BigInt(price), requireSecret(s, "SEPOLIA_RPC_URL"), deployerKey(s, log));
  });

program.command("intent").description("push one typed-data intent to the pendant: the Ledger reads it in words")
  .argument("<action>", "Supply | Repay | Withdraw | Borrow")
  .argument("<amount>", "ETH for Supply/Repay/Withdraw, sUSDC units for Borrow")
  .option("--sim <s>", "simA | simB", "simA")
  .option("--agent <name>", "which named agent is asking", DEFAULT_AGENT)
  .option("--port <n>", "pendant port", String(PENDANT_PORT))
  .action(async (action: string, amount: string, o) => {
    if (!["Supply", "Repay", "Withdraw", "Borrow"].includes(action)) throw new Error(`unknown action ${action}`);
    const s = await loadSecrets();
    const dep = loadDeployments();
    const rpc = requireSecret(s, "SEPOLIA_RPC_URL");
    const sepolia = sepoliaClient(rpc);
    if (!dep.amuletAccount) throw new Error("no amuletAccount in the deployments file");
    const relayer = makeRelayer(rpc, requireSecret(s, "BRAIN_LOG_PK") as `0x${string}`);
    const units = action === "Borrow" ? BigInt(amount) : parseEther(amount);
    const market = (o.sim === "simB" ? dep.simB : dep.simA) as `0x${string}`;
    const simName = o.sim === "simB" ? "Sim-B" : "Sim-A";
    const unit = action === "Borrow" ? `${Number(units) / 1e6} sUSDC` : `${amount} ETH`;
    const intent = {
      summary: `${action} ${unit} on ${simName}`, action, market,
      amount: toHex(units), nonce: toHex(await accountNonce(sepolia, dep.amuletAccount)),
      deadline: toHex(BigInt(Math.floor(Date.now() / 1000) + 900)), account: dep.amuletAccount,
    };
    const pendant = new PendantLink();
    await pendant.listen(Number(o.port));
    log(`listening on ws://${lanIp()}:${o.port}; waiting for the pendant`);
    await new Promise<void>((r) => { if (pendant.connected) r(); else pendant.once("connected", () => r()); });
    await new Promise((r) => setTimeout(r, 1200));
    const id = ulid();
    const p = {
      type: "proposal", id, tier: 2, action: "MOVE_SUPPLY", human: intent.summary,
      rationale: "Typed data: the device reads this, it is not blind signing.",
      tx: { chainId: dep.chainId, to: market, value: toHex(action === "Borrow" ? 0n : units), data: dep.selectors.supply, nonce: 0, maxFeePerGas: toHex(0n), maxPriorityFeePerGas: toHex(0n), gas: 90_000 },
      evidence: { deploymentId: "manual", block: 0, queriedAt: 0, subgraph: "intent" },
      expiresAt: Math.floor(Date.now() / 1000) + 600, intent, agent: o.agent,
    };
    log(`INTENT ${id}: ${intent.summary} (account ${dep.amuletAccount}, nonce ${BigInt(intent.nonce)})`);
    if (!pendant.send(p)) throw new Error("pendant not connected");
    const decision = await pendant.awaitDecision(id, 300_000);
    log(`DECISION ${decision.result}${decision.signature ? " with a signature" : ""}`);
    if (decision.result === "approved" && decision.signature) {
      const hash = await relayer.relay(intent as never, decision.signature);
      log(`relayed by ${relayer.address} → ${hash}`);
      const r = await sepolia.waitForTransactionReceipt({ hash });
      log(`mined in block ${r.blockNumber} status ${r.status} https://sepolia.etherscan.io/tx/${hash}`);
    }
    pendant.close();
  });

program.command("demo").description("one key per scenario, with the pendant connected the whole time")
  .option("--port <n>", "pendant port", String(PENDANT_PORT))
  .action(async (o) => {
    const s = await loadSecrets();
    const dep = loadDeployments();
    const rpc = requireSecret(s, "SEPOLIA_RPC_URL");
    const sepolia = sepoliaClient(rpc);
    if (!dep.amuletAccount) throw new Error("no amuletAccount in the deployments file");
    const dk = deployerKey(s, log);
    const relayer = makeRelayer(rpc, requireSecret(s, "BRAIN_LOG_PK") as `0x${string}`);
    const pendant = new PendantLink();
    await pendant.listen(Number(o.port));
    log(`listening on ws://${lanIp()}:${o.port}`);
    pendant.on("connected", () => log("pendant connected"));
    pendant.on("disconnected", () => log("pendant away"));

    const d: DemoDeps = {
      sepolia, dep, policy: defaultPolicy(dep), pendant, relayer, ledger: LEDGER_ADDRESS,
      setPrice: (p) => setPrice(dep.simA, p, rpc, dk),
      setRecord: async (name, key, value) => {
        await writeRecords(deployerSigner(rpc, dk), loadEnsDeployment().resolver, { [key]: value }, log, name);
        pendant.send({ type: "policy" });
      },
      brainWrite: (name, key, value) =>
        writeRecords(signerFromKey(rpc, requireSecret(s, "BRAIN_LOG_PK") as `0x${string}`), loadEnsDeployment().resolver, { [key]: value }, log, name),
      log,
    };

    console.log(MENU);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let busy = false;
    process.stdin.on("data", (raw: string) => {
      const k = raw.trim().toLowerCase();
      if (k === "q" || raw === "\u0003") { pendant.close(); process.exit(0); }
      if (k === "m") { console.log(MENU); return; }
      if (busy) { log("still on that one — swipe or sign on the wrist first"); return; }
      if (!k || !"1234567890prs".includes(k)) return;
      busy = true;
      runScenario(k, d).catch((e) => log(`failed: ${(e as Error).message.split("\n")[0]}`)).finally(() => { busy = false; });
    });
  });

program.command("attack").description("play a compromised brain: push an out-of-policy proposal, or try to raise the limit on ENS")
  .option("--value <eth>", "allowed call with this much ETH attached (over the cap)")
  .option("--target <addr>", "plain transfer to an address the policy never listed")
  .option("--raise-limit", "brain hot key tries setText(amulet.max_value_wei)")
  .option("--as <agent>", "claim to be this named agent; omit to send with no name at all")
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
      await runAttack({ sepolia, dep, policy, ledger, pendant, recorder, agent: o.as, log }, kind);
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
    const signer = deployerSigner(requireSecret(s, "SEPOLIA_RPC_URL"), deployerKey(s, log));
    log(`deployer ${signer.account.address}, brain ${brain}, ledger ${LEDGER_ADDRESS}`);
    const out = await ensSetup(signer, { brain, records, noSubregistry: !o.subregistry, log });
    log(`${out.name} → resolver ${out.resolver}${out.subregistry ? `, subregistry ${out.subregistry}` : ""}`);
    await showEns(sepoliaClient(requireSecret(s, "SEPOLIA_RPC_URL")));
  });
ens.command("agent").description("give an agent its own name, its own limits and its own face")
  .argument("[label]", "repay | yield | all", "all")
  .action(async (label: string) => {
    const s = await loadSecrets();
    const dep = loadDeployments();
    const brain = privateKeyToAccount(requireSecret(s, "BRAIN_LOG_PK") as `0x${string}`).address;
    const signer = deployerSigner(requireSecret(s, "SEPOLIA_RPC_URL"), deployerKey(s, log));
    const keys = label === "all" ? (Object.keys(AGENTS) as AgentKey[]) : [label as AgentKey];
    for (const k of keys) {
      const a = AGENTS[k];
      if (!a) throw new Error(`unknown agent ${k}`);
      const face = FACES[k];
      const records = {
        ...policyRecords(agentPolicy(k, dep)),
        "amulet.brain": brain,
        "amulet.face": faceRecord(face),
        avatar: faceAvatar(face),
        description: `${a.title} — an Amulet agent. Its limits are the amulet.* records on this name.`,
        "amulet.status": "offline",
      };
      log(`${agentName(a.label)}: cap ${Number(a.caps.max_value_wei) / 1e18} ETH on ${a.caps.targets.join(", ")}`);
      const out = await issueAgent(signer, { label: a.label, records, brain, log });
      log(`  ${out.name} node ${out.node} expires ${new Date(out.expiry * 1000).toISOString().slice(0, 10)}`);
    }
  });

ens.command("revoke").description("blank an agent's policy: the wrist then refuses everything it sends")
  .argument("<label>")
  .action(async (label: string) => {
    const s = await loadSecrets();
    await revokeAgent(deployerSigner(requireSecret(s, "SEPOLIA_RPC_URL"), deployerKey(s, log)), label, log);
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
    await writeRecords(deployerSigner(requireSecret(s, "SEPOLIA_RPC_URL"), deployerKey(s, log)), d.resolver, { [k]: value }, log);
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

// Deploys a fresh AmuletLog from the sealed deployer key and records it in the deployments
// file, keeping the previous address under amuletLogV1 so old history stays readable.
program.command("deploy-log").description("deploy the decision log contract and point the deployments file at it")
  .action(async () => {
    const s = await loadSecrets();
    const rpc = requireSecret(s, "SEPOLIA_RPC_URL");
    const artifact = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "contracts", "out", "AmuletLog.sol", "AmuletLog.json"), "utf8"),
    ) as { bytecode: { object: `0x${string}` }; abi: unknown[] };
    const signer = signerFromKey(rpc, deployerKey(s, log));
    log(`deploying AmuletLog from ${signer.account.address}`);
    const hash = await signer.wallet.deployContract({
      abi: artifact.abi as never, bytecode: artifact.bytecode.object,
      account: signer.account, chain: sepoliaChain,
    });
    const r = await signer.pub.waitForTransactionReceipt({ hash });
    const address = r.contractAddress!;
    log(`AmuletLog at ${address} in block ${r.blockNumber}`);
    const path = resolve(REPO_ROOT, "contracts", "deployments", `${SEPOLIA_CHAIN_ID}.json`);
    const j = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (j.amuletLog && j.amuletLog !== address) j.amuletLogV1 = j.amuletLog;
    j.amuletLog = address;
    j.amuletLogBlock = Number(r.blockNumber);
    (j.selectors as Record<string, string>).record = "0x4b2f0fd6";
    writeFileSync(path, `${JSON.stringify(j, null, 2)}\n`);
    log(`wrote ${path}`);
  });

program.command("keygen").description("fresh hot key for AmuletLog.record; shown once, paste into the plaintext as BRAIN_LOG_PK")
  .action(() => {
    const pk = generatePrivateKey();
    console.log(`address ${privateKeyToAccount(pk).address}`);
    console.log(`BRAIN_LOG_PK=${pk}`);
  });

program.parseAsync().catch((e) => { console.error(`amulet: ${(e as Error).message}`); process.exit(1); });
