/**
 * OpenSearch adapter — AWS-native enterprise search engine.
 * Uses the official @opensearch-project/opensearch client.
 * Supports Amazon OpenSearch Service (managed) and self-hosted.
 */
import { Client } from "@opensearch-project/opensearch";
import { pino } from "pino";
import type { SearchEngine, SearchEngineConfig, SearchDocument, SearchQuery, SearchResponse, SearchResult } from "./types.js";

const log = pino({ name: "search.opensearch" });

export interface OpenSearchOptions {
  /** OpenSearch node URL (default: http://localhost:9200). */
  node?: string | undefined;
  /** Basic auth username (for self-hosted). */
  username?: string | undefined;
  /** Basic auth password (for self-hosted). */
  password?: string | undefined;
  /** AWS region (for managed OpenSearch Service — uses IAM auth). */
  awsRegion?: string | undefined;
  /** Number of replicas (default: 1). */
  replicas?: number | undefined;
  /** Number of shards (default: 2). */
  shards?: number | undefined;
  /** Enable SSL (default: true for non-localhost). */
  ssl?: boolean | undefined;
}

export class OpenSearchEngine implements SearchEngine {
  private readonly client: Client;
  private indexName = "knowledge_documents";
  private readonly shards: number;
  private readonly replicas: number;

  constructor(opts?: OpenSearchOptions) {
    const node = opts?.node ?? process.env.OPENSEARCH_NODE ?? "http://localhost:9200";
    const username = opts?.username ?? process.env.OPENSEARCH_USERNAME ?? "";
    const password = opts?.password ?? process.env.OPENSEARCH_PASSWORD ?? "";

    const useSsl = opts?.ssl ?? !node.includes("localhost");

    this.client = new Client({
      node,
      ...(username && password ? { auth: { username, password } } : {}),
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });

    this.shards = opts?.shards ?? 2;
    this.replicas = opts?.replicas ?? 1;
  }

  async initialize(config?: SearchEngineConfig): Promise<void> {
    if (config?.indexName) this.indexName = config.indexName;

    try {
      const exists = await this.client.indices.exists({ index: this.indexName });
      if (!exists.body) {
        await this.client.indices.create({
          index: this.indexName,
          body: {
            settings: {
              number_of_shards: this.shards,
              number_of_replicas: this.replicas,
              analysis: {
                analyzer: {
                  civitas_text: {
                    type: "custom",
                    tokenizer: "standard",
                    filter: ["lowercase", "asciifolding", "edge_ngram_filter"],
                  },
                },
                filter: {
                  edge_ngram_filter: {
                    type: "edge_ngram",
                    min_gram: 2,
                    max_gram: 20,
                  },
                },
              },
            },
            mappings: {
              properties: {
                id: { type: "keyword" },
                tenantId: { type: "keyword" },
                documentId: { type: "keyword" },
                title: { type: "text", analyzer: "civitas_text", fields: { keyword: { type: "keyword" } } },
                content: { type: "text", analyzer: "civitas_text" },
                tags: { type: "keyword" },
                category: { type: "keyword" },
                indexedAt: { type: "date" },
              },
            },
          },
        });
        log.info({ indexName: this.indexName }, "OpenSearch index created");
      }
    } catch (err) {
      log.warn({ err }, "OpenSearch initialization failed — search may be unavailable");
    }
  }

  async index(doc: SearchDocument): Promise<void> {
    await this.client.index({
      index: this.indexName,
      id: doc.id,
      body: this.toOsDoc(doc),
      refresh: "wait_for",
    });
  }

  async bulkIndex(docs: SearchDocument[]): Promise<void> {
    if (docs.length === 0) return;

    const body: Array<Record<string, unknown>> = [];
    for (const doc of docs) {
      body.push({ index: { _index: this.indexName, _id: doc.id } });
      body.push(this.toOsDoc(doc));
    }

    const result = await this.client.bulk({ body, refresh: "wait_for" });
    if (result.body.errors) {
      const failed = result.body.items.filter((item: { index?: { error?: unknown } }) => item.index?.error);
      log.warn({ failedCount: failed.length }, "Some documents failed to index in OpenSearch");
    }
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    const must: Array<Record<string, unknown>> = [
      { term: { tenantId: query.tenantId } },
    ];

    if (query.q) {
      must.push({
        multi_match: {
          query: query.q,
          fields: ["title^3", "content", "tags^2"],
          type: "best_fields",
          fuzziness: "AUTO",
        },
      });
    }

    const filter: Array<Record<string, unknown>> = [];
    if (query.category) {
      filter.push({ term: { category: query.category } });
    }
    if (query.tags?.length) {
      for (const tag of query.tags) {
        filter.push({ term: { tags: tag } });
      }
    }

    const start = Date.now();
    const result = await this.client.search({
      index: this.indexName,
      body: {
        query: {
          bool: { must, filter },
        },
        from: query.offset ?? 0,
        size: query.limit ?? 20,
        highlight: {
          fields: { title: {}, content: { fragment_size: 150 } },
        },
      },
    });

    const hits: SearchResult[] = (result.body.hits.hits as Array<{
      _id: string;
      _source: { documentId: string; title: string; content: string; tags: string[] };
      _score: number;
      highlight?: Record<string, string[]>;
    }>).map((h) => ({
      id: h._id,
      documentId: h._source.documentId,
      title: h._source.title,
      content: h._source.content,
      tags: h._source.tags ?? [],
      score: h._score ? h._score / 10 : undefined, // normalize roughly to 0-1
      highlights: h.highlight ? Object.fromEntries(Object.entries(h.highlight).map(([k, v]) => [k, (v as string[])[0] ?? ""])) : undefined,
    }));

    const totalHits = typeof result.body.hits.total === "object"
      ? (result.body.hits.total as { value: number }).value
      : (result.body.hits.total as number);

    return {
      hits,
      totalHits,
      processingTimeMs: result.body.took ?? (Date.now() - start),
    };
  }

  async remove(tenantId: string, documentId: string): Promise<void> {
    await this.client.deleteByQuery({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { tenantId } },
              { term: { documentId } },
            ],
          },
        },
      },
      refresh: true,
    });
  }

  async removeAll(tenantId: string): Promise<void> {
    await this.client.deleteByQuery({
      index: this.indexName,
      body: {
        query: { term: { tenantId } },
      },
      refresh: true,
    });
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await this.client.cluster.health();
      return res.body.status === "green" || res.body.status === "yellow";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private toOsDoc(doc: SearchDocument): Record<string, unknown> {
    return {
      tenantId: doc.tenantId,
      documentId: doc.documentId,
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
      category: doc.category ?? "",
      indexedAt: new Date().toISOString(),
    };
  }
}
