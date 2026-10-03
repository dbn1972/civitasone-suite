/** GAP-ADMIN-DISCOVERY-02: GET /v1/admin/discovery/services. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";
import { DEFAULT_SERVICES } from "../src/modules/health/domain.js";
import { resetScanThrottleForTests } from "../src/modules/health/queries.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e790000-0000-4000-8000-0000000000a1";
const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: "5e79acc0-0000-4000-8000-0000000000a1", tid: T, roles, sid: "sess-disc" }, SECRET, 3600)}` });

let app: FastifyInstance;
beforeAll(async () => { process.env.SERVICE_BASE_URL = "http://127.0.0.1"; app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("service discovery registry", () => {
  it("is platform-staff only", async () => {
    for (const roles of [["tenant_admin"], ["employee"]]) {
      expect((await app.inject({ method: "GET", url: "/v1/admin/discovery/services", headers: auth(roles) })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: "/v1/admin/discovery/services" })).statusCode).toBe(401);
  });

  it("lists every registered service with its port, status and the overall health", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/discovery/services", headers: auth(["platform_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(DEFAULT_SERVICES.length);
    expect(body.data[0]).toEqual(expect.objectContaining({ serviceName: expect.any(String), status: expect.any(String) }));
    expect(body.data.find((s: { serviceName: string }) => s.serviceName === "admin-service").port).toBe(3022);
    expect(body.meta).toEqual(expect.objectContaining({ total: DEFAULT_SERVICES.length, throttled: false }));
    expect(["ok", "degraded", "down"]).toContain(body.meta.overall);
  });

  it("a scan re-probes once, and an immediate second scan is throttled instead of probing again", async () => {
    resetScanThrottleForTests();
    const first = await app.inject({ method: "GET", url: "/v1/admin/discovery/services?refresh=1", headers: auth(["super_admin"]) });
    expect(first.statusCode).toBe(200);
    expect(first.json().meta.throttled).toBe(false);
    const second = await app.inject({ method: "GET", url: "/v1/admin/discovery/services?refresh=1", headers: auth(["super_admin"]) });
    expect(second.json().meta.throttled).toBe(true);
    expect(second.json().meta.checkedAt).toBe(first.json().meta.checkedAt);
  });

  it("rejects a bad refresh value and never accepts a caller-supplied target", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/discovery/services?refresh=maybe", headers: auth(["super_admin"]) })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/admin/discovery/services?url=http://169.254.169.254", headers: auth(["super_admin"]) })).statusCode).toBe(400);
  });
});
