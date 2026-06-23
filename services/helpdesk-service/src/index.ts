/**
 * helpdesk-service HTTP entrypoint.
 * Domain owner: tickets, SLA policies, queues, canned responses, CSAT.
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3027);
const app = await buildApp();
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info(`helpdesk-service (API) listening on :${port}`);
