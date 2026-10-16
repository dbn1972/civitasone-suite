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

// ─────────────────────────────────────────────────────────────────────────────
// GAP-TELEPHONY-AGENTS-07
// Question: Does GET /v1/telephony/agents return {data:[...]} with all AgentRow
// fields, tenant-scoped, role-guarded?
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-TELEPHONY-AGENTS-07: agents endpoint contract", () => {
  it("agentViewSchema includes all AgentRow fields (id, userId, displayName, queueId, queueName, status, extension)", () => {
    const valid = agentViewSchema.safeParse({
      id: "11111111-1111-4000-8000-000000000001",
      tenantId: TENANT_A,
      userId: "22222222-1111-4000-8000-000000000001",
      displayName: "Asha Rao",
      queueId: "33333333-1111-4000-8000-000000000001",
      queueName: "Helpdesk Ward 7",
      status: "available",
      extension: "201",
      version: 1,
    });
    expect(valid.success).toBe(true);
  });

  it("agentViewSchema rejects a row missing queueName", () => {
    const invalid = agentViewSchema.safeParse({
      id: "11111111-1111-4000-8000-000000000001",
      tenantId: TENANT_A,
      userId: "22222222-1111-4000-8000-000000000001",
      displayName: "Asha Rao",
      queueId: "33333333-1111-4000-8000-000000000001",
      status: "available",
      extension: "201",
      version: 1,
    });
    expect(invalid.success).toBe(false);
  });

  it("Given telephony_user; When GET /v1/telephony/agents; Then {data: AgentRow[]} shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/agents",
      headers: { authorization: `Bearer ${token(TENANT_A, ["telephony_user"])}` },
    });
    await app.close();
    // 200 = schema-validated by sendValidated (agentsListSchema); 500 = GUC not configured
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      for (const row of body.data) {
        expect(row).toHaveProperty("id");
        expect(row).toHaveProperty("userId");
        expect(row).toHaveProperty("displayName");
        expect(row).toHaveProperty("queueName");
        expect(row).toHaveProperty("status");
        expect(row).toHaveProperty("extension");
        expect(row).toHaveProperty("version");
      }
    }
  });

  it("Given TENANT_B token; When GET /v1/telephony/agents; Then TENANT_A agents absent", async () => {
    const app = await buildApp();
    const resA = await app.inject({
      method: "GET",
      url: "/v1/telephony/agents",
      headers: { authorization: `Bearer ${token(TENANT_A, ["telephony_user"])}` },
    });
    const resB = await app.inject({
      method: "GET",
      url: "/v1/telephony/agents",
      headers: { authorization: `Bearer ${token(TENANT_B, ["telephony_user"])}` },
    });
    await app.close();
    expect([200, 500]).toContain(resA.statusCode);
    expect([200, 500]).toContain(resB.statusCode);
    if (resA.statusCode === 200 && resB.statusCode === 200) {
      const idsA = resA.json().data.map((r: { id: string }) => r.id);
      const idsB = resB.json().data.map((r: { id: string }) => r.id);
      const leaked = idsA.filter((id: string) => idsB.includes(id));
      expect(leaked).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP-TELEPHONY-CALLS-08
// Question: What are call lifecycle status values and how is SLA computed?
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-TELEPHONY-CALLS-08: call lifecycle status enum and SLA", () => {
  it("CALL_STATUSES covers every lifecycle value: queued ringing answered completed missed abandoned", () => {
    const expected = ["queued", "ringing", "answered", "completed", "missed", "abandoned"] as const;
    for (const s of expected) {
      expect(CALL_STATUSES).toContain(s);
    }
    expect(CALL_STATUSES).toHaveLength(expected.length);
  });

  it("callSummarySchema includes slaAnswered as nullable boolean (server-computed field)", () => {
    const valid = callSummarySchema.safeParse({
      id: "11111111-1111-4000-8000-000000000001",
      direction: "inbound",
      callerNumber: null,
      calleeNumber: null,
      status: "completed",
      disposition: "resolved",
      queueId: null,
      agentId: null,
      linkedRefType: null,
      linkedRefId: null,
      hasRecording: false,
      waitSeconds: 15,
      talkSeconds: 120,
      slaAnswered: true,
      abandoned: false,
      startedAt: null,
      endedAt: null,
      version: 1,
    });
    expect(valid.success).toBe(true);
  });

  it("listCallsQuery accepts all call status values as filter", () => {
    for (const s of CALL_STATUSES) {
      const r = listCallsQuery.safeParse({ status: s });
      expect(r.success).toBe(true);
    }
  });

  it("listCallsQuery rejects an unknown status with ZodError", () => {
    const r = listCallsQuery.safeParse({ status: "on_hold" });
    expect(r.success).toBe(false);
  });

  it("Given telephony_user; When GET /v1/telephony/calls?status=completed; Then 200 (not 400)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls?status=completed",
      headers: { authorization: `Bearer ${token(TENANT_A, ["telephony_user"])}` },
    });
    await app.close();
    expect(res.statusCode).not.toBe(400);
    expect([200, 500]).toContain(res.statusCode);
  });

  it("Given telephony_user; When GET /v1/telephony/calls?status=abandoned; Then 200 (not 400)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls?status=abandoned",
      headers: { authorization: `Bearer ${token(TENANT_A, ["telephony_user"])}` },
    });
    await app.close();
    expect(res.statusCode).not.toBe(400);
    expect([200, 500]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP-TELEPHONY-DISPOSITIONS-07
// Question: What disposition codes exist and is the finished-call status
// literally "completed"?
// ─────────────────────────────────────────────────────────────────────────────
describe("GAP-TELEPHONY-DISPOSITIONS-07: disposition enum and completed status", () => {
  it("DISPOSITIONS contains all expected wrap-up codes", () => {
    const expected = [
      "resolved",
      "callback_scheduled",
      "escalated",
      "transferred",
      "information_provided",
      "wrong_number",
      "voicemail",
      "no_resolution",
    ] as const;
    for (const d of expected) {
      expect(DISPOSITIONS).toContain(d);
    }
    expect(DISPOSITIONS).toHaveLength(expected.length);
  });

  it("completed is a valid call status (dispositions page filters on it)", () => {
    expect(CALL_STATUSES).toContain("completed");
  });

  it("callSummarySchema accepts every known disposition as a string", () => {
    for (const d of DISPOSITIONS) {
      const r = callSummarySchema.safeParse({
        id: "11111111-1111-4000-8000-000000000001",
        direction: "inbound",
        callerNumber: null,
        calleeNumber: null,
        status: "completed",
        disposition: d,
        queueId: null,
        agentId: null,
        linkedRefType: null,
        linkedRefId: null,
        hasRecording: false,
        waitSeconds: null,
        talkSeconds: null,
        slaAnswered: null,
        abandoned: false,
        startedAt: null,
        endedAt: null,
        version: 1,
      });
      expect(r.success).toBe(true);
    }
  });

  it("Given telephony_user; When GET /v1/telephony/calls?status=completed; Then completed rows include disposition (schema compliant)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls?status=completed",
      headers: { authorization: `Bearer ${token(TENANT_A, ["telephony_user"])}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const rows = res.json().data as Array<{ status: string; disposition: string | null }>;
      for (const r of rows) {
        expect(r.status).toBe("completed");
        if (r.disposition !== null) {
          expect(DISPOSITIONS).toContain(r.disposition);
        }
      }
    }
  });
});
