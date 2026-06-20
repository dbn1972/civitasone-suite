import { buildApp } from "./app.js";

const app = await buildApp();

await app.listen({
  port: Number(process.env.PORT ?? 3010),
  host: process.env.HOST ?? "0.0.0.0",
});
