/**
 * inventory-service HTTP entrypoint.
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3025);
const app = await buildApp();
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`inventory-service (API) listening on :${port}`);
