/**
 * Meilisearch adapter — lightweight, single-binary search engine.
 * Uses raw fetch (no SDK dependency) for minimal footprint.
 */
import { pino } from "pino";
import type { SearchEngine, SearchEngineConfig, SearchDocument, SearchQuery, SearchResponse, SearchResult } from "./types.js";

const log = pino({ name: "search.meilisearch" });

export interface MeilisearchOptions {
  /** Meilisearch host URL (default: http://localhost:7700). */
  host?: string | undefined;
  /** API key for authentication. */
  apiKey?: string | undefined;
}

export class MeilisearchEngine implements SearchEngine {
  private readonly host: string;
  private readonly apiKey: string;
  private indexName = "knowledge_documents";

  constructor(opts?: MeilisearchOptions) {
    this.host = opts?.host ?? process.env.MEILISEARCH_HOST ?? "http://localhost:7700";
    this.apiKey = opts?.apiKey ?? process.env.MEILISEARCH_API_KEY ?? "";
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
        // Configure filterable & searchable attributes
        await this.fetch(`/indexes/${this.indexName}/settings`, {
          method: "PATCH",
          body: JSON.stringify({
            filterableAttributes: ["tenantId", "category", "tags"],
            searchableAttributes: ["title", "content", "tags"],
            sortableAttributes: ["indexedAt"],
          }),
        });
        log.info({ indexName: this.indexName }, "Meilisearch index created");
      }
    } catch (err) {
      log.warn({ err }, "Meilisearch initialization failed — search will use DB fallback");
    }
  }

  async index(doc: SearchDocument): Promise<void> {
    await this.fetch(`/indexes/${this.indexName}/documents`, {
      method: "POST",
      body: JSON.stringify([this.toMeiliDoc(doc)]),
    });
  }

  async bulkIndex(docs: SearchDocument[]): Promise<void> {
    // Meilisearch handles batches up to ~100MB; chunk at 1000 docs
    const BATCH = 1000;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH).map((d) => this.toMeiliDoc(d));
      await this.fetch(`/indexes/${this.indexName}/documents`, {
        method: "POST",
        body: JSON.stringify(batch),
      });
    }
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    const filter: string[] = [`tenantId = "${this.escape(query.tenantId)}"`];
    if (query.category) filter.push(`category = "${this.escape(query.category)}"`);
    if (query.tags?.length) {
      filter.push(query.tags.map((t) => `tags = "${this.escape(t)}"`).join(" AND "));
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
    await this.fetch(`/indexes/${this.indexName}/documents/delete`, {
      method: "POST",
      body: JSON.stringify({
        filter: `tenantId = "${this.escape(tenantId)}" AND documentId = "${this.escape(documentId)}"`,
      }),
    });
  }

  async removeAll(tenantId: string): Promise<void> {
    await this.fetch(`/indexes/${this.indexName}/documents/delete`, {
      method: "POST",
      body: JSON.stringify({
        filter: `tenantId = "${this.escape(tenantId)}"`,
      }),
    });
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
      indexedAt: new Date().toISOString(),
    };
  }

  private escape(value: string): string {
    return value.replace(/[^a-zA-Z0-9\-_.: /]/g, "").replace(/"/g, '\\"');
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    return globalThis.fetch(`${this.host}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  }
}
