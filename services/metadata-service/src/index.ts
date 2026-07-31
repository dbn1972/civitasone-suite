import { buildApp } from "./app.js";
// 3039 matches this service's gateway registry entry. The previous default of
// 3036 collided with works-service and pointed nowhere the gateway proxies to.
const PORT = Number(process.env.PORT ?? 3039);
const app = await buildApp();
await app.listen({ port: PORT, host: "0.0.0.0" });
