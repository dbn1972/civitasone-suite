/**
 * Meilisearch adapter — lightweight, single-binary search engine.
 * Uses raw fetch (no SDK dependency) for minimal footprint.
 */
import { pino } from "pino";
import type { SearchEngine, SearchEngineConfig, SearchDocument, SearchQuery, SearchResponse, SearchResult } from "./types.js";

const log = pino({ name: "search.meilisearch" });

/** Per-request timeout (ms) for normal calls; override with MEILISEARCH_TIMEOUT_MS. */
function defaultTimeoutMs(): number {
  return Number(process.env.MEILISEARCH_TIMEOUT_MS) || 10_000;
}
/** Longer timeout (ms) for bulk writes; override with MEILISEARCH_BULK_TIMEOUT_MS. */
function bulkTimeoutMs(): number {
  return Number(process.env.MEILISEARCH_BULK_TIMEOUT_MS) || 60_000;
}

/** Index settings applied by initialize() / ensureReady(). `kind` and `accessLevel` back the clearance filters. */
const SETTINGS = {
  filterableAttributes: ["tenantId", "category", "tags", "accessLevel", "kind"],
  searchableAttributes: ["title", "content", "tags"],
  sortableAttributes: ["indexedAt"],
};

export interface MeilisearchOptions {
  /** Meilisearch host URL (default: http://localhost:7700). */
  host?: string | undefined;
  /** API key for authentication. */
  apiKey?: string | undefined;
  /** Index name (default: "knowledge_documents"). Normally set by initialize({ indexName }). */
  indexName?: string | undefined;
}

/**
 * A search was refused because a filter attribute is not filterable on the index yet
 * (Meilisearch `invalid_search_filter`), typically an index created before a newer attribute such as
 * `kind` was added. Recoverable by (re)applying the index settings; NEVER by dropping the filter.
 */
export class SearchFilterError extends Error {
  readonly code = "invalid_search_filter" as const;
  constructor(message: string) {
    super(message);
    this.name = "SearchFilterError";
  }
}

export class MeilisearchEngine implements SearchEngine {
  private readonly host: string;
  private readonly apiKey: string;
  private indexName = "knowledge_documents";

  constructor(opts?: MeilisearchOptions) {
    this.host = opts?.host ?? process.env.MEILISEARCH_HOST ?? "http://localhost:7700";
    this.apiKey = opts?.apiKey ?? process.env.MEILISEARCH_API_KEY ?? "";
    if (opts?.indexName) this.indexName = opts.indexName;
  }

  /**
   * Make the index search-ready: create it if missing and (re)apply the settings (filterable attributes),
   * then WAIT for Meilisearch to finish the settings task (it is asynchronous: a search sent right after the
   * PATCH can still be refused). Unlike initialize() this THROWS on failure so a caller can memoise success
   * and retry failure. Idempotent.
   */
  async ensureReady(): Promise<void> {
    const get = await this.fetch(`/indexes/${this.indexName}`, { method: "GET" });
    if (get.status === 404) {
      const created = await this.fetch("/indexes", { method: "POST", body: JSON.stringify({ uid: this.indexName, primaryKey: "id" }) });
      if (!created.ok) {
        // Another process created it between our GET and POST: that is success, continue to the settings.
        let code = "";
        try { code = String(((await created.json()) as { code?: unknown }).code ?? ""); } catch { /* no JSON body */ }
        if (code !== "index_already_exists") throw new Error(`Meilisearch index create failed: ${created.status}`);
      } else {
        await this.waitForTask(created);
      }
    } else if (!get.ok) {
      throw new Error(`Meilisearch index lookup failed: ${get.status}`);
    }
    const patched = await this.fetch(`/indexes/${this.indexName}/settings`, { method: "PATCH", body: JSON.stringify(SETTINGS) });
    if (!patched.ok) throw new Error(`Meilisearch settings failed: ${patched.status}`);
    await this.waitForTask(patched);
  }

  /** Poll the task a 202 response names until it succeeds; throws if it fails or does not finish in time. */
  private async waitForTask(res: Response): Promise<void> {
    let uid: unknown;
    try { uid = ((await res.json()) as { taskUid?: unknown }).taskUid; } catch { return; }
    if (typeof uid !== "number") return;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const t = await this.fetch(`/tasks/${uid}`, { method: "GET" });
      if (t.ok) {
        const task = (await t.json()) as { status?: string; error?: { message?: string } };
        if (task.status === "succeeded") return;
        if (task.status === "failed" || task.status === "canceled") throw new Error(`Meilisearch task ${uid} ${task.status}: ${task.error?.message ?? ""}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Meilisearch task ${uid} did not finish in time`);
  }

  async initialize(config?: SearchEngineConfig): Promise<void> {
    if (config?.indexName) this.indexName = config.indexName;

    try {
      const res = await this.fetch(`/indexes/${this.indexName}`, { method: "GET" });
      if (res.status === 404) {
        await this.fetch("/indexes", {
          method: "POST",
          body: JSON.stringify({ uid: this.indexName, primaryKey: "id" }),
        });
        log.info({ indexName: this.indexName }, "Meilisearch index created");
      }
      // Always (re)apply the settings, for new AND existing indexes, so that
      // accessLevel is filterable in production without a manual step. The
      // PATCH is idempotent.
      await this.fetch(`/indexes/${this.indexName}/settings`, {
        method: "PATCH",
        body: JSON.stringify(SETTINGS),
      });
    } catch (err) {
      log.warn({ err }, "Meilisearch initialization failed — search will use DB fallback");
    }
  }

  async index(doc: SearchDocument): Promise<void> {
    const res = await this.fetch(`/indexes/${this.indexName}/documents`, {
      method: "POST",
      body: JSON.stringify([this.toMeiliDoc(doc)]),
    });
    if (!res.ok) throw new Error(`Meilisearch index failed: ${res.status}`);
  }

  async bulkIndex(docs: SearchDocument[]): Promise<void> {
    // Meilisearch handles batches up to ~100MB; chunk at 1000 docs
    const BATCH = 1000;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH).map((d) => this.toMeiliDoc(d));
      const res = await this.fetch(`/indexes/${this.indexName}/documents`, {
        method: "POST",
        body: JSON.stringify(batch),
      }, bulkTimeoutMs());
      if (!res.ok) throw new Error(`Meilisearch bulkIndex failed: ${res.status}`);
    }
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    const filter: string[] = [`tenantId = "${this.escape(query.tenantId)}"`];
    if (query.category) filter.push(`category = "${this.escape(query.category)}"`);
    if (query.tags?.length) {
      filter.push(query.tags.map((t) => `tags = "${this.escape(t)}"`).join(" AND "));
    }
    if (query.tagsAny) {
      // OR across the tags. Empty list = matches nothing (fail closed), like accessLevels.
      // includeUntagged adds `(tags IS EMPTY AND <clearance>) OR (tags NOT EXISTS AND <clearance>)` INSIDE the same parenthesised clause, so the
      // tenant clause above still ANDs with it (a separate array element = AND in Meilisearch).
      const parts = query.tagsAny.map((t) => `tags = "${this.escape(t)}"`);
      if (query.includeUntagged) {
        // Untagged documents are further limited to the caller's clearance (null = every level).
        const lv = query.includeUntagged.accessLevels;
        const level = lv === null ? "" : ` AND (${(lv.length ? lv : ["__none__"]).map((l) => `accessLevel = "${this.escape(l)}"`).join(" OR ")})`;
        parts.push(`(tags IS EMPTY${level})`, `(tags NOT EXISTS${level})`);
      }
      filter.push(parts.length ? `(${parts.join(" OR ")})` : `tags = "__none__"`);
    }
    if (query.knowledgeAccessLevels) {
      // Knowledge documents only: (kind != "knowledge") OR (accessLevel in cleared levels). A record with no
      // kind (every module record) satisfies the first branch, so it is untouched. A separate array element,
      // so it is ANDed with the tenant and module clauses.
      const lv = query.knowledgeAccessLevels.length ? query.knowledgeAccessLevels : ["__none__"];
      filter.push(`(kind != "knowledge" OR (${lv.map((l) => `accessLevel = "${this.escape(l)}"`).join(" OR ")}))`);
    }
    if (query.accessLevels) {
      // Empty list = matches nothing (fail closed).
      filter.push(
        query.accessLevels.length
          ? `(${query.accessLevels.map((l) => `accessLevel = "${this.escape(l)}"`).join(" OR ")})`
          : `accessLevel = "__none__"`,
      );
    }

    const start = Date.now();
    const res = await this.fetch(`/indexes/${this.indexName}/search`, {
      method: "POST",
      body: JSON.stringify({
        q: query.q,
        filter,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
        showRankingScore: true,
      }),
    });

    if (!res.ok) {
      let code = "";
      try { code = String(((await res.json()) as { code?: unknown }).code ?? ""); } catch { /* no JSON body */ }
      if (code === "invalid_search_filter") throw new SearchFilterError(`Meilisearch search failed: ${res.status} (${code})`);
      throw new Error(`Meilisearch search failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      hits: Array<{ id: string; documentId: string; title: string; content: string; tags: string[]; _rankingScore?: number }>;
      estimatedTotalHits?: number;
      processingTimeMs?: number;
    };

    const hits: SearchResult[] = data.hits.map((h) => ({
      id: h.id,
      documentId: h.documentId,
      title: h.title,
      content: h.content,
      tags: h.tags ?? [],
      score: h._rankingScore,
    }));

    return {
      hits,
      totalHits: data.estimatedTotalHits ?? hits.length,
      processingTimeMs: data.processingTimeMs ?? (Date.now() - start),
    };
  }

  async remove(tenantId: string, documentId: string): Promise<void> {
    // Meilisearch deletion by filter requires v1.2+
    const res = await this.fetch(`/indexes/${this.indexName}/documents/delete`, {
      method: "POST",
      body: JSON.stringify({
        filter: `tenantId = "${this.escape(tenantId)}" AND documentId = "${this.escape(documentId)}"`,
      }),
    });
    if (!res.ok) throw new Error(`Meilisearch remove failed: ${res.status}`);
  }

  async removeAll(tenantId: string): Promise<void> {
    const res = await this.fetch(`/indexes/${this.indexName}/documents/delete`, {
      method: "POST",
      body: JSON.stringify({
        filter: `tenantId = "${this.escape(tenantId)}"`,
      }),
    }, bulkTimeoutMs());
    if (!res.ok) throw new Error(`Meilisearch removeAll failed: ${res.status}`);
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await this.fetch("/health", { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // No persistent connections with fetch
  }

  private toMeiliDoc(doc: SearchDocument): Record<string, unknown> {
    return {
      id: doc.id,
      tenantId: doc.tenantId,
      documentId: doc.documentId,
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
      category: doc.category ?? "",
      kind: doc.kind ?? "",
      accessLevel: doc.accessLevel ?? "internal",
      indexedAt: new Date().toISOString(),
    };
  }

  private escape(value: string): string {
    // Allow-list: every character that could terminate or escape the quoted filter literal (", \\, ...) is
    // removed outright, so no escaping step is needed (an escaping step that handled `"` but not `\\` would be
    // the CodeQL js/incomplete-sanitization shape).
    return value.replace(/[^a-zA-Z0-9\-_.: /]/g, "");
  }

  /**
   * CLOS3-S6-14: every request is bounded. Without a signal a Meilisearch host
   * that accepts the connection and never answers hung index/search/remove and
   * the document-index consumers forever. A caller-supplied signal wins.
   * Bulk operations (bulkIndex/removeAll) get the longer BULK timeout.
   */
  private async fetch(path: string, init: RequestInit, timeoutMs: number = defaultTimeoutMs()): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    return globalThis.fetch(`${this.host}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs), headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  }
}
