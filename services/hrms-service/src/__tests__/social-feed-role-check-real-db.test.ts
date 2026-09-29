/**
 * GET /v1/hrms/social/feed and GET /v1/hrms/birthdays/today role-gate
 * regression test (GAP-HR-SF-16 item 2 + same-class twin).
 *
 * SEC finding: both handlers called resolveContext(req) but NEVER
 * requireRole — any authenticated caller in ANY (or no recognised) role got
 * the full combined feed, including every employee whose birthday is today
 * (name/department/designation). Fixed by adding the same role set the
 * feature is meant for (HR_ROLES + manager + employee). Whether birthdays
 * should additionally require an opt-in consent flag is a separate,
 * still-open product decision tracked elsewhere — this only verifies the
 * containment gate itself, via status codes (no DB fixtures needed: an
 * empty tenant's feed/birthdays list is legitimately empty, so this is a
 * pure role-check regression test, not a data-scoping one).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-0f18-4000-8000-000000000f18";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-social-feed-role-test" }, SECRET);
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe.each([
  ["GET /v1/hrms/social/feed", "/v1/hrms/social/feed"],
  ["GET /v1/hrms/birthdays/today", "/v1/hrms/birthdays/today"],
])("%s — role gate", (_label, url) => {
  it("a caller with NO recognised HR/manager/employee role is rejected (403), not served the feed", async () => {
    const r = await app.inject({
      method: "GET", url,
      headers: { authorization: `Bearer ${tok(["guest"], "social-feed-guest-f18")}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("a caller with NO roles at all is rejected (403)", async () => {
    const r = await app.inject({
      method: "GET", url,
      headers: { authorization: `Bearer ${tok([], "social-feed-noroles-f18")}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("a bare employee is served the feed (200) — unchanged, the feature's own audience", async () => {
    const r = await app.inject({
      method: "GET", url,
      headers: { authorization: `Bearer ${tok(["employee"], "social-feed-employee-f18")}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it("a manager is served the feed (200) — unchanged", async () => {
    const r = await app.inject({
      method: "GET", url,
      headers: { authorization: `Bearer ${tok(["manager"], "social-feed-manager-f18")}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it("HR is served the feed (200) — unchanged", async () => {
    const r = await app.inject({
      method: "GET", url,
      headers: { authorization: `Bearer ${tok(["hr_admin"], "social-feed-hr-f18")}` },
    });
    expect(r.statusCode).toBe(200);
  });
});
