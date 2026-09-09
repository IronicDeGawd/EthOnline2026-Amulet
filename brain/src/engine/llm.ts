// Nova Lite writes the two lines the pendant shows. It never chooses the action or the
// amount: those arrive as fixed facts and the output is checked to still contain them.
// Anything slow or off-script falls back to a template so the wrist is never blocked.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { LLM_TIMEOUT_MS, NOVA_MODEL } from "../config.js";
import type { Candidate } from "./rules.js";
import type { Evidence } from "../data/graph/freshness.js";

export interface Explanation { human: string; rationale: string; source: "nova" | "template" }

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
  return {
    system:
      "You write the two lines a small wearable shows before its owner approves a DeFi action. " +
      "The action and every number are already decided; copy them exactly, never change, add or drop a figure. " +
      "Reply with JSON only: {\"human\": string, \"rationale\": string}. human <= 60 chars, one line, imperative. " +
      "rationale <= 90 chars, one sentence, plain words, states why now.",
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
        return acceptOutput(text, c) ?? fallback;
      } catch {
        return fallback;
      }
    },
  };
}

export const templateExplainer: Explainer = { explain: async (c) => templateFor(c) };
