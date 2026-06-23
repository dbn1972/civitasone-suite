import { buildApp } from "./app.js";
const port = Number(process.env.PORT ?? 3003);
const app = await buildApp();
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info(`policy-service (API) listening on :${port}`);
