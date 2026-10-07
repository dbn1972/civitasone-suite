/**
 * GAP-TENANT-SETTINGS-01 — the per-key settings read (GET /v1/settings/:key)
 * used to require only an authenticated session with a tenant id. A single
 * configuration key can hold a credential/secret value (e.g. smtp_password),
 * so any signed-in employee of the tenant could read an individual secret-typed
 * key. It is now gated to admin roles, matching the already-admin-gated list
 * route (/v1/settings). These assertions fail on the old (gate-less) handler.
 *
 * 401/403 are decided by auth + requireRole BEFORE any DB access, so this test
 * needs no seeded rows.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa550001-5555-4000-8000-000000a50001";
const ACTOR = "aa55aaaa-5555-4000-8000-000000a5000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-set01" }, SECRET, 3600);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/settings/:key — SETTINGS-01 role gate", () => {
  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/settings/smtp_password" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a bare employee (cannot read an individual secret-typed key)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/settings/smtp_password",
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("does NOT 403 a tenant_admin (gate allows admin roles through)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/settings/smtp_password",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
    });
    await app.close();
    // Admin passes the gate; the key is absent in this throwaway tenant, so a
    // 404 (not 403) is the expected "authorised but nothing there" outcome.
    expect(res.statusCode).not.toBe(403);
    expect([200, 404]).toContain(res.statusCode);
  });
});
