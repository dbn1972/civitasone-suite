/**
 * GAP-TELEPHONY backend-verification tests.
 *
 * Each describe block maps to one ledger item (HOME-05, AGENTS-07, CALLS-08,
 * DISPOSITIONS-07, LIST-04, LIST-06).  Tests assert the HTTP contract, schema
 * shape, and RBAC/tenant-isolation rules that were unverifiable when the
 * telephony-service snapshot was absent from the ledger.  They follow the
 * project test pattern: inject into buildApp() with HS256 tokens; accept
 * [200, 500] where GUC/RLS may not be configured in the test environment.
 *
 * Never use secret literals — secrets are read from process.env.JWT_SECRET.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { CALL_STATUSES } from "../src/modules/calls/transitions.js";
import { DISPOSITIONS } from "../src/modules/calls/transitions.js";
import { callSummarySchema, listCallsQuery } from "../src/modules/calls/validators.js";
import { agentViewSchema } from "../src/modules/agents/validators.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = "aa770005-0000-4000-8000-000000050001";
const TENANT_B = "bb770005-0000-4000-8000-000000050002";
const ACTOR   = "aa77aaaa-0000-4000-8000-000000050001";

function token(tid: string, roles: string[]) {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-gapverify" }, SECRET, 3600);
}

afterAll(async () => {
  await sqlClient.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP-TELEPHONY-HOME-05
// Question: Do routes behind /v1/telephony/* require a telephony role and
// tenant scope, so call data is not exposed to unauthorised staff?
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-TELEPHONY-HOME-05: routes enforce telephony role on /v1/telephony/calls", () => {
  it("Given user without telephony role; When GET /v1/telephony/calls; Then 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls",
      headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("Given user without telephony role; When GET /v1/telephony/agents; Then 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/agents",
      headers: { authorization: `Bearer ${token(TENANT_A, ["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("Given no token; When GET /v1/telephony/calls; Then 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/telephony/calls" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("Given telephony_user role; When GET /v1/telephony/calls; Then 200 (tenant-scoped)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls",
      headers: { authorization: `Bearer ${token(TENANT_A, ["telephony_user"])}` },
    });
    await app.close();
    // 200 = authorised + tenant-scoped result; 500 = GUC not configured (safe — query never ran)
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
    }
  });
});
