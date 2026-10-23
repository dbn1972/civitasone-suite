import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerRateLimit } from "../src/index.js";

/** Mirrors authPlugin: a decorated req.ctx populated from a verified source. */
async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("ctx", null);
  app.addHook("onRequest", async (req) => {
    const t = req.headers["x-test-ctx-tenant"] as string | undefined;
    (req as unknown as { ctx: { tenantId: string } | null }).ctx = t === undefined ? null : { tenantId: t };
  });
  await registerRateLimit(app, { max: 1, timeWindow: "1 minute", allowList: [] });
  app.get("/x", async () => ({ ok: true }));
  await app.ready();
  return app;
}
const hit = (app: FastifyInstance, tenant?: string) =>
  app.inject({ method: "GET", url: "/x", remoteAddress: "10.0.0.5", headers: tenant === undefined ? {} : { "x-test-ctx-tenant": tenant } });

describe("CLOS2-S6-01 default rate-limit key is per real tenant", () => {
  it("two tenants behind one IP get separate buckets", async () => {
    const app = await build();
    expect((await hit(app, "tenant-a")).statusCode).toBe(200);
    expect((await hit(app, "tenant-b")).statusCode).toBe(200);
    expect((await hit(app, "tenant-a")).statusCode).toBe(429);
    await app.close();
  });

  it("null ctx and empty tenantId fall back to the IP bucket", async () => {
    const app = await build();
    expect((await hit(app)).statusCode).toBe(200);
    expect((await hit(app)).statusCode).toBe(429);
    const app2 = await build();
    expect((await hit(app2, "")).statusCode).toBe(200);
    expect((await hit(app2, "")).statusCode).toBe(429);
    await app.close(); await app2.close();
  });

  it("an x-tenant-id header alone never changes the bucket", async () => {
    const app = await build();
    const h = (t: string) => app.inject({ method: "GET", url: "/x", remoteAddress: "10.0.0.5", headers: { "x-tenant-id": t } });
    expect((await h("a")).statusCode).toBe(200);
    expect((await h("b")).statusCode).toBe(429);
    await app.close();
  });
});
