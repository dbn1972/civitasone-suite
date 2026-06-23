import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? 3008);
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "procurement-service listening");
