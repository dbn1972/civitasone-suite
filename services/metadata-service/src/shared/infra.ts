import { Cache } from "@civitasone/cache";
import { createQueue } from "@civitasone/queue";
export const cache = new Cache({ service: "metadata", defaultTtlSeconds: 60 });
export const queue = createQueue();
