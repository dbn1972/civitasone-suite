import { Cache } from "@civitasone/cache";
import { createQueue } from "@civitasone/queue";
import { guardSubscriptions } from "@civitasone/module-licence";
import { licence, CROSS_MODULE_CONSUMERS } from "./licence.js";
import { SERVICE } from "../topics.js";

export const cache = new Cache({ service: SERVICE, defaultTtlSeconds: Number(process.env.CACHE_TTL ?? 60) });
export const queue = guardSubscriptions(createQueue(), licence, CROSS_MODULE_CONSUMERS);
