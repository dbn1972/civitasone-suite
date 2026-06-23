/**
 * crm-service HTTP entrypoint.
 * Domain owner: leads, contacts, organisations, pipelines, deals, activities.
 * Writes via @civitasone/queue; reads via @civitasone/cache; DB civitas_crm only (L1).
 *
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3024);
const app = await buildApp();
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info(`crm-service (API) listening on :${port}`);
