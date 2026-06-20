import { buildApp } from "./app.js";
const port = Number(process.env.PORT ?? 3006);
const app = await buildApp();
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`notification-service (API) listening on :${port}`);
