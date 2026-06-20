import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? 3007);
await app.listen({ port, host: "0.0.0.0" });
app.log.info({ port }, "finance-service listening");
