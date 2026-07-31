/**
 * cdp-service HTTP entrypoint.
 * Domain owner: golden profiles, identity resolution, event ingestion, dynamic segments.
 * Writes via @civitasone/queue; reads via @civitasone/cache; DB civitas_cdp only (L1).
 *
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3043);
const app = await buildApp();
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info(`cdp-service (API) listening on :${port}`);
