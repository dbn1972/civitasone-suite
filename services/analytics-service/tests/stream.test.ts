/**
 * SSE stream endpoint tests — real-time dashboard push.
 *
 * GET /v1/analytics/stream — Server-Sent Events
 *
 * Tests:
 *   - Route registration and auth: 401/403
 *   - SSE headers verification via HTTP request
 *   - Event emission: emitDashboardUpdate triggers data on the bus (unit)
 *   - Tenant isolation: events don't leak cross-tenant
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import http from "node:http";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-9999-4000-8000-000000000099";
const ACTOR = "cccccccc-9999-4000-8000-000000000099";

function token(roles = ["analytics_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-stream" }, SECRET);
}

function headers(roles = ["analytics_admin"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

afterAll(async () => {
  // Clean up any lingering listeners
});

describe("GET /v1/analytics/stream", () => {
  it("returns correct SSE headers (Content-Type: text/event-stream)", async () => {
    const app = await buildApp();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    const responseHeaders = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${port}/v1/analytics/stream`,
        { headers: headers() },
        (res) => {
          resolve(res.headers);
          res.destroy();
          req.destroy();
        },
      );
      req.on("error", reject);
      setTimeout(() => { req.destroy(); reject(new Error("timeout")); }, 3000);
    });

    await app.close();

    expect(responseHeaders["content-type"]).toBe("text/event-stream");
    expect(responseHeaders["cache-control"]).toBe("no-cache");
    expect(responseHeaders["connection"]).toBe("keep-alive");
  });

  it("emits connected event with tenant data on connection", async () => {
    const app = await buildApp();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    const body = await new Promise<string>((resolve, reject) => {
      let data = "";
      const req = http.get(
        `http://127.0.0.1:${port}/v1/analytics/stream`,
        { headers: headers() },
        (res) => {
          res.on("data", (chunk) => {
            data += chunk.toString();
            // Once we get the connected event, resolve
            if (data.includes("event: connected")) {
              res.destroy();
              req.destroy();
              resolve(data);
            }
          });
        },
      );
      req.on("error", () => resolve(data));
      setTimeout(() => { req.destroy(); resolve(data); }, 3000);
    });

    await app.close();

    expect(body).toContain("event: connected");
    expect(body).toContain(TENANT);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${port}/v1/analytics/stream`,
        (res) => {
          resolve(res.statusCode ?? 500);
          res.destroy();
          req.destroy();
        },
      );
      req.on("error", reject);
      setTimeout(() => { req.destroy(); reject(new Error("timeout")); }, 3000);
    });

    await app.close();
    expect(statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${port}/v1/analytics/stream`,
        { headers: headers(["citizen"]) },
        (res) => {
          resolve(res.statusCode ?? 500);
          res.destroy();
          req.destroy();
        },
      );
      req.on("error", reject);
      setTimeout(() => { req.destroy(); reject(new Error("timeout")); }, 3000);
    });

    await app.close();
    expect(statusCode).toBe(403);
  });
});

describe("emitDashboardUpdate", () => {
  it("is a callable function that emits events on the bus", async () => {
    const { dashboardBus, emitDashboardUpdate } = await import("../src/modules/stream/routes.js");

    const received: unknown[] = [];
    const listener = (event: unknown) => received.push(event);
    dashboardBus.on(`update:${TENANT}`, listener);

    emitDashboardUpdate({
      tenantId: TENANT,
      metric: "new_leads",
      value: 42,
      timestamp: new Date().toISOString(),
    });

    dashboardBus.off(`update:${TENANT}`, listener);

    expect(received.length).toBe(1);
    expect(received[0]).toMatchObject({
      tenantId: TENANT,
      metric: "new_leads",
      value: 42,
    });
  });

  it("does not emit to other tenants (tenant isolation)", async () => {
    const { dashboardBus, emitDashboardUpdate } = await import("../src/modules/stream/routes.js");

    const otherTenant = "bbbbbbbb-9999-4000-8000-000000000099";
    const received: unknown[] = [];
    const listener = (event: unknown) => received.push(event);
    dashboardBus.on(`update:${otherTenant}`, listener);

    emitDashboardUpdate({
      tenantId: TENANT,
      metric: "new_leads",
      value: 42,
      timestamp: new Date().toISOString(),
    });

    dashboardBus.off(`update:${otherTenant}`, listener);

    expect(received.length).toBe(0);
  });
});
