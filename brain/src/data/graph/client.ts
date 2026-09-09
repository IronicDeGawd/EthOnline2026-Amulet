// GraphQL over the Graph gateway with the Studio key. Every query also asks for `_meta`
// so freshness can be judged per response, not per session.
import { GRAPH_GATEWAY, SUBGRAPHS, type SubgraphKey } from "../../config.js";

export interface Meta { block: { number: number }; deployment: string; hasIndexingErrors: boolean }
export interface GraphResult<T> { data: T; meta: Meta; queriedAt: number; subgraph: SubgraphKey }

export const META_FIELDS = "_meta { block { number } deployment hasIndexingErrors }";

export class GraphClient {
  constructor(private readonly apiKey: string, private readonly fetchFn: typeof fetch = fetch) {}

  async query<T>(key: SubgraphKey, body: string, variables: Record<string, unknown> = {}): Promise<GraphResult<T>> {
    const sg = SUBGRAPHS[key];
    const url = `${GRAPH_GATEWAY}/${this.apiKey}/subgraphs/id/${sg.id}`;
    const query = body.includes("_meta") ? body : body.replace("{", `{ ${META_FIELDS}`);
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`graph ${sg.name}: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T & { _meta: Meta }; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`graph ${sg.name}: ${json.errors[0].message}`);
    if (!json.data) throw new Error(`graph ${sg.name}: empty response`);
    const { _meta, ...data } = json.data;
    return { data: data as T, meta: _meta, queriedAt: Math.floor(Date.now() / 1000), subgraph: key };
  }
}
