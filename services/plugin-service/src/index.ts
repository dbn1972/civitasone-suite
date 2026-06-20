import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3017);
const app = await buildApp();
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`plugin-service (API) listening on :${port}`);
