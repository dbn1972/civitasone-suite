/**
 * GAP-ADMIN-ROLES-05 (system-role 403 passes through the permissions PATCH relay) and
 * GAP-ADMIN-TECH-ADMIN-03 (GET /v1/admin/health/services list for the Tech Admin page).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "bbbbbbbb-cccc-4000-8000-0000000000a4";
const ACTOR = "00000000-cccc-4000-8000-0000000000a4";
const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}` });
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body }) as Response;

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("PATCH /v1/admin/roles/:id/permissions - system role refusal", () => {
  const roleId = "66666666-6666-4666-8666-666666666666";
  it("relays identity-service's 403 SYSTEM_ROLE_READONLY as a 403 (not a 207 partial)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method: string }) => {
      if (url.endsWith(`/identity/rbac/roles/${roleId}`)) return json(200, { id: roleId, isSystem: true, permissions: [] });
      if (url.includes("/identity/rbac/permissions")) return json(200, [{ id: "p1", key: "finance.read" }]);
      if (init.method === "POST") return json(403, { code: "SYSTEM_ROLE_READONLY", message: "system role", correlationId: "c" });
      throw new Error(`unexpected ${init.method} ${url}`);
    }));
    const res = await app.inject({ method: "PATCH", url: `/v1/admin/roles/${roleId}/permissions`, headers: hdr(["tenant_admin"]), payload: { permissionKeys: ["finance.read"] } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SYSTEM_ROLE_READONLY");
  });
});

describe("GET /v1/admin/health/services", () => {
  it("is super-admin only", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/health/services", headers: hdr(["tenant_admin"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/admin/health/services" })).statusCode).toBe(401);
  });
  it("returns {serviceName, port, status, httpStatus} rows, not a 404 from the :service route", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes(":3001/") ? json(200, { status: "ok" }) : json(503, {}))));
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/services", headers: hdr(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ serviceName: string; port: number; status: string; httpStatus: number }>;
    expect(rows.length).toBeGreaterThan(5);
    const identity = rows.find((r) => r.serviceName === "identity-service")!;
    expect(identity.port).toBe(3001);
    expect(identity).toHaveProperty("status");
    expect(identity).toHaveProperty("httpStatus");
  });
});
