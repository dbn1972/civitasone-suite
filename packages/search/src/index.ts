/**
 * @civitasone/search — Unified search engine adapter.
 *
 * Supports two providers:
 *   - "meilisearch" (default) — lightweight, single-binary, great for on-prem
 *   - "opensearch" — AWS-native, enterprise-grade, managed or self-hosted
 *
 * Provider is selected via SEARCH_ENGINE env var or explicit factory call.
 *
 * Usage:
 *   import { createSearchEngine } from "@civitasone/search";
 *   const engine = createSearchEngine(); // reads SEARCH_ENGINE env
 *   await engine.initialize();
 *   await engine.index({ id, tenantId, documentId, title, content, tags });
 *   const results = await engine.search({ q: "budget", tenantId });
 */

export type { SearchEngine, SearchEngineConfig, SearchDocument, SearchQuery, SearchResponse, SearchResult } from "./types.js";
export { MeilisearchEngine, type MeilisearchOptions } from "./meilisearch.js";
export { OpenSearchEngine, type OpenSearchOptions } from "./opensearch.js";
export {
  publishSearchIndex,
  SEARCH_INDEX_TOPIC,
  SEARCH_INDEX_EVENT_TYPE,
  type SearchIndexDocument,
  type PublishSearchIndexInput,
} from "./indexing.js";
export type { DrizzleTx } from "./indexing-types.js";

import type { SearchEngine } from "./types.js";
import { MeilisearchEngine } from "./meilisearch.js";
import { OpenSearchEngine } from "./opensearch.js";

export type SearchProvider = "meilisearch" | "opensearch";

/**
 * Factory: create the appropriate search engine based on configuration.
 *
 * @param provider - Explicit provider choice. Defaults to SEARCH_ENGINE env var, then "meilisearch".
 */
export function createSearchEngine(provider?: SearchProvider): SearchEngine {
  const engine = provider ?? (process.env.SEARCH_ENGINE as SearchProvider | undefined) ?? "meilisearch";

  switch (engine) {
    case "opensearch":
      return new OpenSearchEngine();
    case "meilisearch":
      return new MeilisearchEngine();
    default:
      throw new Error(`Unknown search engine provider: "${engine}". Use "meilisearch" or "opensearch".`);
  }
}
