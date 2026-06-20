/**
 * location-service HTTP entrypoint.
 * Domain owner: tenant locations and LGD address master data.
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 4012);
const app = await buildApp();
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`location-service (API) listening on :${port}`);
