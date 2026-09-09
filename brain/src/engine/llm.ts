// Nova Lite writes the two lines the pendant shows. It never chooses the action or the
// amount: those arrive as fixed facts and the output is checked to still contain them.
// Anything slow or off-script falls back to a template so the wrist is never blocked.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { LLM_TIMEOUT_MS, NOVA_MODEL } from "../config.js";
import type { Candidate } from "./rules.js";
import type { Evidence } from "../data/graph/freshness.js";

export interface Explanation { human: string; rationale: string; source: "nova" | "template"; reason?: string }

export const MAX_LINE = 96; // PROP_TEXT_LEN on the pendant, minus the NUL

export function templateFor(c: Candidate): Explanation {
  const f = c.facts;
  switch (c.action) {
    case "REPAY_DEBT":
      return {
        human: `Repay ${f.amount} on ${f.market}`,
        rationale: `Health factor ${f.hf} is under ${f.threshold}; repaying ${f.debt} lifts it toward ${f.target}.`,
        source: "template",
      };
    case "ADD_COLLATERAL":
      return {
        human: `Add ${f.amount} collateral on ${f.market}`,
        rationale: `Health factor ${f.hf} slipped under ${f.threshold}; topping up restores ${f.target}.`,
        source: "template",
      };
    case "ADVISORY":
      return {
        human: `${f.market} utilization ${f.from}% to ${f.to}%`,
        rationale: `Borrow demand jumped ${f.delta} pts in ${f.window} blocks; rates now ${f.borrowRate}%. No action needed.`,
        source: "template",
      };
    default:
      return { human: `${c.action} on ${f.market}`, rationale: "Rule fired.", source: "template" };
  }
}

export function buildPrompt(c: Candidate, ev: Evidence): { system: string; user: string } {
  const facts = Object.entries(c.facts).map(([k, v]) => `${k}: ${v}`).join("\n");
  const verb = c.action === "REPAY_DEBT" ? "Repay" : c.action === "ADD_COLLATERAL" ? "Add" : "Note";
  const must = [c.facts.amount, c.facts.hf].filter(Boolean).join(" and ");
  return {
    system:
      "You write the two lines a small wearable shows before its owner approves a DeFi action. " +
      "The action and every number are already decided. Copy figures exactly as given; never change, round, add or drop one. " +
      `Both "${must}" must appear verbatim across the two lines. Never print internal names like REPAY_DEBT or HF_LOW. ` +
      "Reply with JSON only, no code fences: {\"human\": string, \"rationale\": string}. " +
      `human <= 60 chars, one line, starts with "${verb}", names the amount and the market. ` +
      "rationale <= 90 chars, one plain sentence saying why now, quoting the health factor figure. " +
      'Example: {"human":"Repay 0.01 ETH on Sim-A","rationale":"Health factor 1.07 is under 1.25; this brings it back toward 1.40."}',
    user:
      `action: ${c.action}\nrule: ${c.rule}\n${facts}\n` +
      `evidence: ${ev.subgraph} deployment ${ev.deploymentId.slice(0, 10)}… block ${ev.block}`,
  };
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Accepts the model's text only if the fixed figures survived intact.
export function acceptOutput(text: string, c: Candidate): Explanation | undefined {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  let j: { human?: unknown; rationale?: unknown };
  try { j = JSON.parse(m[0]); } catch { return undefined; }
  if (typeof j.human !== "string" || typeof j.rationale !== "string") return undefined;
  const human = oneLine(j.human, MAX_LINE);
  const rationale = oneLine(j.rationale, MAX_LINE);
  const mustKeep = [c.facts.amount, c.facts.hf].filter((x): x is string => typeof x === "string");
  for (const k of mustKeep) {
    if (!human.includes(k) && !rationale.includes(k)) return undefined;
  }
  return { human, rationale, source: "nova" };
}

export interface Explainer { explain(c: Candidate, ev: Evidence): Promise<Explanation> }

export function makeNovaExplainer(region: string, timeoutMs = LLM_TIMEOUT_MS): Explainer {
  const client = new BedrockRuntimeClient({ region });
  return {
    async explain(c, ev) {
      const fallback = templateFor(c);
      const { system, user } = buildPrompt(c, ev);
      try {
        const res = await client.send(
          new ConverseCommand({
            modelId: NOVA_MODEL,
            system: [{ text: system }],
            messages: [{ role: "user", content: [{ text: user }] }],
            inferenceConfig: { maxTokens: 160, temperature: 0.3 },
          }),
          { abortSignal: AbortSignal.timeout(timeoutMs) },
        );
        const text = res.output?.message?.content?.map((b) => b.text ?? "").join("") ?? "";
        return acceptOutput(text, c) ?? { ...fallback, reason: `rejected: ${text.replace(/\s+/g, " ").slice(0, 160)}` };
      } catch (e) {
        return { ...fallback, reason: `${(e as Error).name}: ${(e as Error).message.split("\n")[0].slice(0, 160)}` };
      }
    },
  };
}

export const templateExplainer: Explainer = { explain: async (c) => templateFor(c) };
