import { Cache } from "@civitasone/cache";
/** Bus lives in @civitasone/queue-service; imported via @civitasone/queue facade. */
import { createQueue } from "@civitasone/queue";
import { SERVICE } from "../topics.js";

export const cache = new Cache({ service: SERVICE, defaultTtlSeconds: Number(process.env.CACHE_TTL ?? 60) });
export const queue = createQueue();
