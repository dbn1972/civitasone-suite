import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8080);
const app = await buildApp();
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
app.log.info({ port }, "gateway-service listening");
