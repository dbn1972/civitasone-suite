/**
 * Infrastructure singletons: queue + cache for inspection-service.
 * Rule: every query handler consults the cache (read-through) before Postgres;
 * writes never touch the read path — the consumer invalidates here.
 */
import { Cache } from "@civitasone/cache";
import { createQueue } from "@civitasone/queue";
import { SERVICE } from "../topics.js";

export const cache = new Cache({
  service: SERVICE,
  defaultTtlSeconds: Number(process.env.CACHE_TTL ?? 60),
});

export const queue = createQueue();
