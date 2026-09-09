// The freshness gate. Evidence is usable only when it came from the pinned deployment and
// is at most MAX_BLOCK_LAG blocks behind the chain head. Anything else makes the brain
// stand down rather than propose on stale or substituted data.
import { MAX_BLOCK_LAG, SUBGRAPHS, type SubgraphKey } from "../../config.js";
import type { Meta } from "./client.js";

export interface Evidence {
  deploymentId: string;
  block: number;
  queriedAt: number;
  subgraph: string;
}

export type FreshnessVerdict =
  | { ok: true; evidence: Evidence; lag: number }
  | { ok: false; reason: "wrong_deployment" | "stale" | "indexing_errors"; detail: string };

export function checkFreshness(
  key: SubgraphKey,
  meta: Meta,
  headBlock: number,
  queriedAt: number,
  maxLag = MAX_BLOCK_LAG,
  pinnedOverride?: string,
): FreshnessVerdict {
  const pinned = pinnedOverride ?? SUBGRAPHS[key].deployment;
  if (meta.deployment !== pinned) {
    return { ok: false, reason: "wrong_deployment", detail: `${meta.deployment} is not the pinned ${pinned}` };
  }
  if (meta.hasIndexingErrors) {
    return { ok: false, reason: "indexing_errors", detail: `${SUBGRAPHS[key].name} reports indexing errors` };
  }
  const lag = headBlock - meta.block.number;
  if (lag > maxLag) {
    return { ok: false, reason: "stale", detail: `block ${meta.block.number} is ${lag} behind head ${headBlock}` };
  }
  return {
    ok: true,
    lag,
    evidence: { deploymentId: meta.deployment, block: meta.block.number, queriedAt, subgraph: SUBGRAPHS[key].name },
  };
}
