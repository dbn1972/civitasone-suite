import { Cache } from "@civitasone/cache";
/** Bus lives in @civitasone/queue-service; imported via the @civitasone/queue facade. */
import { createQueue } from "@civitasone/queue";
import { createSearchEngine, type SearchEngine } from "@civitasone/search";
import * as storage from "@civitasone/storage";
import { SERVICE } from "../topics.js";

/**
 * Shared infrastructure singletons for court-service.
 *
 * - `cache`  — Redis read-through cache (getOrLoad / invalidate). Keyed by
 *              {service}:{tenant}:{resource}:{id}. Default TTL from CACHE_TTL (60s).
 * - `queue`  — SQS / RabbitMQ adapter (QUEUE_DRIVER env). Routes publish commands
 *              here; the worker subscribes. Never write to Postgres from a route.
 * - `search` — Knowledge-base / case-register / order-and-judgment search engine
 *              (SEARCH_ENGINE env: meilisearch | opensearch). Lazily connected via
 *              `search.initialize()`; constructing the adapter here is side-effect free.
 * - `storage`— S3 / MinIO object storage for cause-lists, signed orders, and
 *              case-file bundles. Function-based module API (client is created lazily on
 *              first call), re-exported as a namespace for a single import site.
 */
export const cache = new Cache({ service: SERVICE, defaultTtlSeconds: Number(process.env.CACHE_TTL ?? 60) });
export const queue = createQueue();
export const search: SearchEngine = createSearchEngine();
export { storage };
