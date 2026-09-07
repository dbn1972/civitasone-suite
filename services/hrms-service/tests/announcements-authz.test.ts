/**
 * Regression test for a real, live security gap found while drafting
 * .claude/skills/19-security-beyond-tenancy.md: POST /v1/hrms/announcements
 * was doc-commented "(HR admin only)" but called no authz helper at all --
 * unlike its sibling handlers in the same file (travel-requests/expenses
 * approve), which all correctly call requireRole(ctx, [...]). Any
 * authenticated employee of any role could post an org-wide announcement.
 *
 * Fixed by adding requireRole(ctx, ["hr_admin", "super_admin"]) matching
 * the doc comment intent, before the request body is even parsed.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-9999-4000-8000-000000000009";

function token(roles: string[]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

function payload() {
  return { title: "Notice", body: "A regular org-wide notice for all staff.", category: "general" };
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/hrms/announcements -- authz (HR admin only)", () => {
  it("rejects a plain employee with 403, not 201", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/announcements",
      headers: { authorization: `Bearer ${token(["employee"])}` },
      payload: payload(),
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("rejects a manager with 403 -- doc comment says HR admin only, not manager", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/announcements",
      headers: { authorization: `Bearer ${token(["manager"])}` },
      payload: payload(),
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("allows hr_admin (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/announcements",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
      payload: payload(),
    });
    await app.close();
    expect(r.statusCode).toBe(201);
  });

  it("allows super_admin (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/announcements",
      headers: { authorization: `Bearer ${token(["super_admin"])}` },
      payload: payload(),
    });
    await app.close();
    expect(r.statusCode).toBe(201);
  });
});
