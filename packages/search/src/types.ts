/**
 * @civitasone/search — Provider-agnostic search engine interface.
 *
 * Supports Meilisearch (default, lightweight) and OpenSearch (AWS-native, enterprise).
 * The engine choice is driven by SEARCH_ENGINE env var: "meilisearch" | "opensearch".
 */

/** A document to be indexed. */
export interface SearchDocument {
  /** Unique document ID (UUID). */
  id: string;
  /** Tenant isolation key. */
  tenantId: string;
  /** The document reference ID (may differ from search index id). */
  documentId: string;
  /** Document title (primary search field). */
  title: string;
  /** Document body content (secondary search field). */
  content: string;
  /** Faceting/filter tags. */
  tags: string[];
  /** Optional category for filtering. */
  category?: string | undefined;
  /** Additional fields for extended search (e.g. department, priority). */
  metadata?: Record<string, unknown> | undefined;
}

/** Search query parameters. */
export interface SearchQuery {
  /** Free-text query string. */
  q: string;
  /** Tenant ID for isolation (mandatory). */
  tenantId: string;
  /** Optional category filter. */
  category?: string | undefined;
  /** Optional tag filter (AND logic). */
  tags?: string[] | undefined;
  /** Results limit (default 20, max 200). */
  limit?: number | undefined;
  /** Offset for pagination. */
  offset?: number | undefined;
}

/** A single search result. */
export interface SearchResult {
  id: string;
  documentId: string;
  title: string;
  content: string;
  tags: string[];
  /** Relevance score (engine-specific, 0-1 normalized where possible). */
  score?: number | undefined;
  /** Highlighted snippets (if supported). */
  highlights?: Record<string, string> | undefined;
}

/** Search response wrapper. */
export interface SearchResponse {
  hits: SearchResult[];
  totalHits: number;
  processingTimeMs: number;
}

/** Configuration for search engine initialization. */
export interface SearchEngineConfig {
  /** Index name (default: "knowledge_documents"). */
  indexName?: string | undefined;
  /** Tenant isolation strategy: "filter" (shared index) or "index" (per-tenant index). */
  tenantStrategy?: "filter" | "index" | undefined;
}

/** The search engine adapter interface — all providers implement this. */
export interface SearchEngine {
  /** Initialize the engine (create indexes, set mappings, etc.). */
  initialize(config?: SearchEngineConfig): Promise<void>;
  /** Index a single document (upsert). */
  index(doc: SearchDocument): Promise<void>;
  /** Index multiple documents in bulk. */
  bulkIndex(docs: SearchDocument[]): Promise<void>;
  /** Search for documents. */
  search(query: SearchQuery): Promise<SearchResponse>;
  /** Remove a document by its documentId + tenantId. */
  remove(tenantId: string, documentId: string): Promise<void>;
  /** Remove all documents for a tenant. */
  removeAll(tenantId: string): Promise<void>;
  /** Health check — returns true if engine is reachable. */
  healthy(): Promise<boolean>;
  /** Gracefully close connections. */
  close(): Promise<void>;
}
