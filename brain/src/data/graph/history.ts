// The agent's own memory, read back from the subgraph that indexes its decisions. An agent
// that cannot see what it already asked for asks again, and being refused twice for the same
// reason is the single most annoying thing a wearable can do to its owner.
//
// This is the one query whose answer is about the agent itself: what it asked, what the wrist
// said, and how recently.

export const AMULET_SUBGRAPH =
  "https://api.studio.thegraph.com/query/1758963/amulet-decisions/v0.1.0";

export interface PastAction {
  outcome: string;
  value: string;
  target: string;
  timestamp: number;
}

export interface AgentHistory {
  label: string;
  requests: number;
  approved: number;
  rejected: number;
  refusedByPolicy: number;
  expired: number;
  recent: PastAction[];
}

// Anyone may call AmuletLog.record — the contract says so, and that is deliberate: a log only
// this brain could write would prove nothing. But it means anyone can emit an entry claiming
// to be any agent. So memory is read back filtered by the key that actually writes ours;
// everything else in that index is someone else's log, not this agent's past.
const QUERY = `query($id: String!, $writer: Bytes!, $n: Int!) {
  actions(first: $n, orderBy: timestamp, orderDirection: desc, where: { agentLabel: $id, sender: $writer }) {
    outcome value target timestamp
  }
}`;

// Never fatal: a subgraph that is down or still syncing costs the agent its memory, not its
// ability to act. The caller treats undefined as "no history to speak of".
export async function fetchHistory(
  label: string,
  writer: `0x${string}` | undefined,
  n = 5,
  url = AMULET_SUBGRAPH,
  timeoutMs = 8000,
): Promise<AgentHistory | undefined> {
  // With no writer to trust, there is no memory: an unfiltered read would hand the model
  // whatever a stranger chose to write about this agent.
  if (!writer) return undefined;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { id: label, writer: writer.toLowerCase(), n } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { data?: { actions?: Record<string, unknown>[] } };
    const rows = j.data?.actions ?? [];
    if (!rows.length) return undefined;
    // Counted here rather than read from the Agent entity: that entity aggregates every
    // writer, and only the rows this brain wrote are this agent's history.
    return tally(label, rows.map((r) => ({
      outcome: String(r.outcome ?? ""), value: String(r.value ?? "0"),
      target: String(r.target ?? ""), timestamp: Number(r.timestamp ?? 0),
    })));
  } catch {
    return undefined;
  }
}

export function tally(label: string, recent: PastAction[]): AgentHistory {
  const count = (o: string) => recent.filter((r) => r.outcome === o).length;
  return {
    label,
    requests: recent.length,
    approved: count("approved"),
    rejected: count("rejected"),
    refusedByPolicy: count("policy_reject"),
    expired: count("expired"),
    recent,
  };
}

function ago(seconds: number): string {
  if (seconds < 90) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

const SAID: Record<string, string> = {
  approved: "approved it",
  rejected: "swiped it away",
  policy_reject: "refused it before you saw it — it broke your limits",
  expired: "never answered",
};

// The lines that go into the model's brief. Plain sentences, because the model reads them:
// "you were refused twice for the same thing" has to land as discouragement, not as data.
export function historyLines(h: AgentHistory | undefined, now = Date.now()): string {
  if (!h || h.requests === 0) return "you have never asked this owner for anything before\n";
  const refused = h.rejected + h.refusedByPolicy;
  const head =
    `your history with this owner: ${h.requests} request${h.requests === 1 ? "" : "s"}, ` +
    `${h.approved} approved, ${refused} refused, ${h.expired} left unanswered\n`;
  const lines = h.recent
    .slice(0, 5)
    .map((r) => {
      const eth = (Number(r.value) / 1e18).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
      // Never paste an outcome we do not recognise into the prompt: the log is writable by
      // anyone, and an unknown value is exactly where injected text would arrive.
      const said = SAID[r.outcome] ?? "did something we have no word for";
      return `  ${ago(Math.max(0, now / 1000 - r.timestamp))}: you asked for ${eth} ETH — they ${said}\n`;
    })
    .join("");
  const recentRefusals = h.recent.filter((r) => r.outcome === "policy_reject" || r.outcome === "rejected").length;
  const warn = recentRefusals >= 2
    ? "you have been refused more than once recently: do not ask for the same thing again unless something has actually changed\n"
    : "";
  return head + lines + warn;
}
