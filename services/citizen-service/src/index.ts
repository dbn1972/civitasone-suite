import { buildApp } from "./app.js";

const app = await buildApp();

await app.listen({
  port: Number(process.env.PORT ?? 3020),
  host: process.env.BIND_HOST ?? "127.0.0.1",
});
