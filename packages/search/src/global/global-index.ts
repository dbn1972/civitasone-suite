/**
 * `global_search` index adapter (Meilisearch, raw fetch like the existing adapter).
 *
 * TENANT ISOLATION (defence in depth, each layer sufficient on its own for the attacks it names):
 *  1. every document carries `tenantId` and its id embeds the tenant (an event for tenant A cannot overwrite B's doc);
 *  2. `search()` has no filter parameter: the engine filter is BUILT HERE from a validated UUID tenant and a list of
 *     catalogue entity types. Nothing the client sent (q, page, ...) is ever spliced into the filter, and `q` travels
 *     as the engine's query field, which is not parsed as filter syntax;
 *  3. when a search-only key is configured the request is signed with a per-tenant TENANT TOKEN whose rule the engine
 *     ANDs on server side, so a filter bug cannot widen the scope;
 *  4. every returned hit is re-checked (tenantId, entity type) before it leaves this class.
 */
import { pino } from "pino";
import { GLOBAL_ENTITY_TYPES, hrefForEntity, isGlobalEntityType, type GlobalEntityType } from "./catalogue.js";
import { UUID_RE, globalDocId, type GlobalSearchDocument } from "./contract.js";
import { createTenantToken, tenantFilterRule } from "./tenant-token.js";

const log = pino({ name: "search.global" });

export const GLOBAL_INDEX_NAME = "global_search";

export interface GlobalSearchIndexOptions {
  host?: string | undefined;
  /** Key used for writes/initialisation (index admin). */
  apiKey?: string | undefined;
  indexName?: string | undefined;
  /** Search-only key value + uid: when both are set every search is signed as a tenant token. */
  searchKey?: string | undefined;
  searchKeyUid?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  tokenTtlSec?: number | undefined;
}

export interface GlobalSearchHit {
  entityType: GlobalEntityType;
  entityId: string;
  module: string;
  title: string;
  refNumber: string;
  status: string;
  summary: string;
  href: string;
  score?: number | undefined;
}

export interface GlobalSearchRequest {
  tenantId: string;
  q: string;
  /** Entity types the caller may see (from entityTypesForRoles). Empty => no query is sent and no hit is returned. */
  entityTypes: readonly GlobalEntityType[];
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface GlobalSearchResult {
  hits: GlobalSearchHit[];
  totalHits: number;
}

export class GlobalSearchIndex {
  private readonly host: string;
  private readonly apiKey: string;
  readonly indexName: string;
  private readonly searchKey: string;
  private readonly searchKeyUid: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenTtlSec: number;

  constructor(opts: GlobalSearchIndexOptions = {}) {
    this.host = opts.host ?? process.env.MEILISEARCH_HOST ?? "http://localhost:7700";
    this.apiKey = opts.apiKey ?? process.env.MEILISEARCH_API_KEY ?? "";
    this.indexName = opts.indexName ?? process.env.GLOBAL_SEARCH_INDEX ?? GLOBAL_INDEX_NAME;
    this.searchKey = opts.searchKey ?? process.env.MEILISEARCH_SEARCH_KEY ?? "";
    this.searchKeyUid = opts.searchKeyUid ?? process.env.MEILISEARCH_SEARCH_KEY_UID ?? "";
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.tokenTtlSec = opts.tokenTtlSec ?? 300;
  }

  /** True when searches are signed with a per-tenant token. */
  get usesTenantTokens(): boolean {
    return Boolean(this.searchKey && this.searchKeyUid);
  }

  /** Create the index and (idempotently) apply settings. Returns the settings task uid so callers/tests can await it. */
  async initialize(): Promise<number | undefined> {
    const get = await this.call(`/indexes/${this.indexName}`, { method: "GET" }, this.apiKey);
    if (get.status === 404) {
      const created = await this.call("/indexes", { method: "POST", body: JSON.stringify({ uid: this.indexName, primaryKey: "id" }) }, this.apiKey);
      if (!created.ok) throw new Error(`global index create failed: ${created.status}`);
    } else if (!get.ok) {
      throw new Error(`global index probe failed: ${get.status}`);
    }
    const res = await this.call(
      `/indexes/${this.indexName}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({
          filterableAttributes: ["tenantId", "entityType", "module"],
          searchableAttributes: ["title", "refNumber", "summary"],
          sortableAttributes: ["indexedAt"],
        }),
      },
      this.apiKey,
    );
    if (!res.ok) throw new Error(`global index settings failed: ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { taskUid?: number };
    return body.taskUid;
  }

  async upsert(docs: GlobalSearchDocument[]): Promise<number | undefined> {
    if (docs.length === 0) return undefined;
    const BATCH = 1000;
    let last: number | undefined;
    for (let i = 0; i < docs.length; i += BATCH) {
      const res = await this.call(`/indexes/${this.indexName}/documents`, { method: "POST", body: JSON.stringify(docs.slice(i, i + BATCH)) }, this.apiKey);
      if (!res.ok) throw new Error(`global index upsert failed: ${res.status}`);
      last = ((await res.json().catch(() => ({}))) as { taskUid?: number }).taskUid;
    }
    return last;
  }

  /** Remove one record. The id embeds the tenant, so this can only ever delete that tenant's document. */
  async remove(tenantId: string, entityType: GlobalEntityType, entityId: string): Promise<number | undefined> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(entityId) || !isGlobalEntityType(entityType)) throw new Error("invalid remove arguments");
    const id = globalDocId(tenantId.toLowerCase(), entityType, entityId.toLowerCase());
    const res = await this.call(`/indexes/${this.indexName}/documents/${encodeURIComponent(id)}`, { method: "DELETE" }, this.apiKey);
    if (!res.ok && res.status !== 404) throw new Error(`global index remove failed: ${res.status}`);
    return ((await res.json().catch(() => ({}))) as { taskUid?: number }).taskUid;
  }

  /** Remove every global document of one tenant (switch-off / purge). */
  async removeTenant(tenantId: string): Promise<number | undefined> {
    const res = await this.call(`/indexes/${this.indexName}/documents/delete`, { method: "POST", body: JSON.stringify({ filter: tenantFilterRule(tenantId) }) }, this.apiKey);
    if (!res.ok) throw new Error(`global index purge failed: ${res.status}`);
    return ((await res.json().catch(() => ({}))) as { taskUid?: number }).taskUid;
  }

  /** Poll an engine task to completion (tests, backfill). */
  async waitForTask(taskUid: number | undefined, timeoutMs = 15_000): Promise<void> {
    if (taskUid === undefined) return;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const res = await this.call(`/tasks/${taskUid}`, { method: "GET" }, this.apiKey);
      const t = (await res.json().catch(() => ({}))) as { status?: string; error?: { message?: string } };
      if (t.status === "succeeded") return;
      if (t.status === "failed" || t.status === "canceled") throw new Error(`engine task ${taskUid} ${t.status}: ${t.error?.message ?? ""}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`engine task ${taskUid} timed out`);
  }

  /** The exact filter sent to the engine. Exported for tests; built only from validated inputs. */
  static buildFilter(tenantId: string, entityTypes: readonly GlobalEntityType[]): string[] {
    const typeClause = entityTypes.map((t) => {
      if (!isGlobalEntityType(t)) throw new Error("unknown entity type");
      return `entityType = "${t}"`;
    });
    return [tenantFilterRule(tenantId), `(${typeClause.join(" OR ")})`];
  }

  async search(req: GlobalSearchRequest): Promise<GlobalSearchResult> {
    const tenantId = req.tenantId.toLowerCase();
    // Fail closed: nothing the caller is allowed to see => do not even ask the engine.
    if (req.entityTypes.length === 0) return { hits: [], totalHits: 0 };
    const filter = GlobalSearchIndex.buildFilter(tenantId, req.entityTypes);
    const credential = this.usesTenantTokens
      ? createTenantToken({
          apiKey: this.searchKey,
          keyUid: this.searchKeyUid,
          tenantId,
          indexName: this.indexName,
          expiresAtSec: Math.floor(Date.now() / 1000) + this.tokenTtlSec,
        })
      : this.apiKey;
    const limit = Math.min(50, Math.max(1, Math.trunc(req.limit ?? 20)));
    const offset = Math.max(0, Math.trunc(req.offset ?? 0));
    const res = await this.call(
      `/indexes/${this.indexName}/search`,
      { method: "POST", body: JSON.stringify({ q: req.q, filter, limit, offset, showRankingScore: true }) },
      credential,
    );
    if (!res.ok) throw new Error(`global search failed: ${res.status}`);
    const data = (await res.json()) as { hits: Array<Record<string, unknown>>; estimatedTotalHits?: number; totalHits?: number };
    const allowed = new Set<string>(req.entityTypes);
    const hits: GlobalSearchHit[] = [];
    for (const h of data.hits ?? []) {
      // Layer 4: never trust the engine's filtering alone.
      if (typeof h.tenantId !== "string" || h.tenantId.toLowerCase() !== tenantId) {
        log.error({ expectedTenant: tenantId }, "global search returned a foreign-tenant hit; dropped");
        continue;
      }
      if (!isGlobalEntityType(h.entityType) || !allowed.has(h.entityType)) continue;
      const entityId = String(h.entityId ?? "");
      if (!UUID_RE.test(entityId)) continue;
      const refNumber = String(h.refNumber ?? "");
      hits.push({
        entityType: h.entityType,
        entityId,
        module: GLOBAL_ENTITY_TYPES[h.entityType].module,
        title: String(h.title ?? ""),
        refNumber,
        status: String(h.status ?? "unknown"),
        summary: String(h.summary ?? ""),
        href: hrefForEntity(h.entityType, entityId, refNumber || undefined),
        score: typeof h._rankingScore === "number" ? h._rankingScore : undefined,
      });
    }
    return { hits, totalHits: data.estimatedTotalHits ?? data.totalHits ?? hits.length };
  }

  async healthy(): Promise<boolean> {
    try {
      return (await this.call("/health", { method: "GET" }, this.apiKey)).ok;
    } catch {
      return false;
    }
  }

  private call(path: string, init: RequestInit, bearer: string, timeoutMs = Number(process.env.MEILISEARCH_TIMEOUT_MS) || 10_000): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    return this.fetchImpl(`${this.host}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs), headers });
  }
}
