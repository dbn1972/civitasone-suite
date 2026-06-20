import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? 3019);
await app.listen({ port, host: "0.0.0.0" });
app.log.info({ port }, "grant-service listening");
