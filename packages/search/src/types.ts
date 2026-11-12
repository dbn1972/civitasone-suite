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
  /**
   * What kind of record this is. knowledge-service stamps its own documents `"knowledge"`; module
   * records (finance, hrms ...) carry none. Lets a query apply access-level clearance to EVERY knowledge
   * document, whatever tags it carries (see SearchQuery.knowledgeAccessLevels).
   */
  kind?: string | undefined;
  /**
   * Access level of the source document (e.g. public/internal/restricted/confidential).
   * Indexed so a query can be restricted to the levels the caller is cleared for.
   * Defaults to "internal" when omitted.
   */
  accessLevel?: string | undefined;
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
  /** Optional tag filter (OR logic): the document must carry AT LEAST ONE of these tags. Combined with `tags` by AND. */
  tagsAny?: string[] | undefined;
  /**
   * Only meaningful with `tagsAny`. When true, documents that carry NO tags at all also qualify
   * (`tags IN tagsAny OR (tags IS EMPTY AND accessLevel IN accessLevels)`). The tenant filter is always ANDed
   * outside this clause, so untagged documents are visible only inside their own tenant. `accessLevels` is
   * the caller's clearance for those untagged documents and is REQUIRED (no default): a list limits them to
   * those levels (an empty list shows none), `null` means cleared for every level. Tagged documents are not
   * affected. Default (option absent): untagged documents are not included.
   */
  /**
   * Clearance for knowledge documents (`kind = "knowledge"`), applied whether they are tagged or not, so a
   * tag chosen by an author or a client can never move a restricted document past the clearance check.
   * A list limits knowledge documents to those access levels (empty = none); `null` = cleared for every
   * level. `undefined` (absent) applies no knowledge clearance (non-knowledge callers). Non-knowledge
   * records (no `kind`) are never affected.
   */
  knowledgeAccessLevels?: readonly string[] | null | undefined;
  includeUntagged?: { accessLevels: readonly string[] | null } | undefined;
  /**
   * When set, only documents whose indexed accessLevel is in this list are
   * retrieved (applied inside the engine query). Documents indexed without a
   * level never match a restricted query.
   */
  accessLevels?: string[] | undefined;
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
  /**
   * Optional: make the index search-ready (create it, apply settings, wait for them), THROWING on failure.
   * Lets a caller initialise lazily, memoise success and retry failure. Not all providers need it.
   */
  ensureReady?(): Promise<void>;
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
