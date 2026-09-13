/**
 * SEC-016 — /v1/quotas/increment and /v1/tenant/usage/increment are
 * documented as internal service-to-service calls only. They used to gate on
 * `requireRole(ctx, [...PLATFORM_ADMIN, "service_account"])`
 * (PLATFORM_ADMIN = ["platform_admin", "super_admin"]). The "service_account"
 * entry never actually matches — that string is never present in ctx.roles,
 * only ctx.actorType carries it (see packages/auth/src/context.ts) — so the
 * array's real gate included bare `super_admin`, a role an ordinary human
 * admin can hold, on routes meant for internal automation only.
 *
 * `platform_admin` is a distinct, separately-legitimate human role (it
 * already gates the strictly more powerful `POST /v1/quotas` SET route one
 * line above in routes.ts) and remains allowed. A genuine internal caller is
 * now recognised via ctx.actorType directly instead of the dead
 * "service_account" string.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa160016-1616-4000-8000-000000016016";
const ACTOR = "aa16aaaa-1616-4000-8000-0000000160aa";
const INTERNAL_SECRET = "test_internal_secret_for_sec016_32ch";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-sec016" }, SECRET, 3600);
}

function bearer(roles: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

function internalHeaders() {
  return { "x-internal": "1", "x-service-secret": INTERNAL_SECRET, "x-tenant-id": TENANT };
}

const validPayload = { tenantId: TENANT, resource: "api_calls_daily", delta: 5 };

beforeEach(() => { vi.stubEnv("INTERNAL_SERVICE_SECRET", INTERNAL_SECRET); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await sqlClient.end(); });

for (const url of ["/v1/quotas/increment", "/v1/tenant/usage/increment"]) {
  describe(`POST ${url} — SEC-016 internal-only gate`, () => {
    it("returns 403 for a human super_admin who does not hold platform_admin", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url,
        headers: bearer(["super_admin"]),
        payload: validPayload,
      });
      await app.close();
      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for an ordinary authenticated tenant user", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url,
        headers: bearer(["employee"]),
        payload: validPayload,
      });
      await app.close();
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without authentication", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url, payload: validPayload });
      await app.close();
      expect(res.statusCode).toBe(401);
    });

    it("still returns 202 for a genuine internal service-to-service caller", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url,
        headers: internalHeaders(),
        payload: validPayload,
      });
      await app.close();
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("accepted");
    });

    it("still returns 202 for platform_admin (distinct legitimate human role, unaffected)", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url,
        headers: bearer(["platform_admin"]),
        payload: validPayload,
      });
      await app.close();
      expect(res.statusCode).toBe(202);
    });
  });
}
