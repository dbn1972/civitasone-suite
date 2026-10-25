/**
 * Citizen engagement (alerts / notices / surveys) — route + consumer integration tests.
 *
 * Replaces the honest-501 stubs formerly in modules/gap/routes.ts with real
 * stores (migration 0041). Real HTTP route -> memory queue -> consumer -> DB
 * round trip. Covers: role gates (403), tenant isolation (RLS + explicit
 * predicates), draft/withdrawn invisibility to bare citizens, derived "expired",
 * the maker/checker split (officer drafts, a different officer or admin publishes), idempotent state
 * transitions, owner-scoped survey responses, and audit emission.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerEngagementConsumers } from "../src/modules/engagement/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

registerEngagementConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "a1a1a1a1-0000-4000-8000-000000000041";
const TENANT_B = "b2b2b2b2-0000-4000-8000-000000000041";
const CITIZEN_1 = "11111111-0000-4000-8000-000000000041";
const CITIZEN_2 = "22222222-0000-4000-8000-000000000041";
const OFFICER   = "33333333-0000-4000-8000-000000000041";
const OFFICER_2 = "77777777-0000-4000-8000-000000000041";
const ADMIN     = "44444444-0000-4000-8000-000000000041";
const ADMIN_B   = "55555555-0000-4000-8000-000000000041";
const CITIZEN_B = "66666666-0000-4000-8000-000000000041";

const tok = (tenant: string, actor: string, roles: string[]) =>
  signToken({ sub: actor, tid: tenant, roles, sid: "sess-engagement" }, SECRET, 3600);
const hdr = (t: string, tenant = TENANT_A) => ({ authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": tenant });

const citizen1 = () => hdr(tok(TENANT_A, CITIZEN_1, ["citizen"]));
const citizen2 = () => hdr(tok(TENANT_A, CITIZEN_2, ["citizen"]));
const officer  = () => hdr(tok(TENANT_A, OFFICER, ["citizen_officer"]));
const officer2 = () => hdr(tok(TENANT_A, OFFICER_2, ["citizen_officer"]));
const admin    = () => hdr(tok(TENANT_A, ADMIN, ["citizen_admin"]));
const adminB   = () => hdr(tok(TENANT_B, ADMIN_B, ["citizen_admin"]), TENANT_B);
const citizenB = () => hdr(tok(TENANT_B, CITIZEN_B, ["citizen"]), TENANT_B);

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function post(url: string, headers: Record<string, string>, payload?: unknown) {
  return app.inject({ method: "POST", url, headers, payload: (payload ?? {}) as object });
}
async function get(url: string, headers: Record<string, string>) {
  return app.inject({ method: "GET", url, headers });
}
async function listRows(path: string, headers: Record<string, string>): Promise<Array<Record<string, unknown>>> {
  const res = await get(path, headers);
  expect(res.statusCode).toBe(200);
  return res.json().data;
}
async function auditActions(tenant: string): Promise<string[]> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    return sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant} AND topic = 'audit.event.record'`;
  });
  return rows.map((r: { payload: { action: string; resourceType: string } | string }) => {
    const p = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
    return `${p.resourceType}:${p.action}`;
  });
}

// ═══════════════════════════════ alerts ═══════════════════════════════
describe("alerts — GET/POST /v1/citizen/alerts", () => {
  let alertId: string;

  it("a bare citizen cannot create an alert (403); an officer can draft (202)", async () => {
    const denied = await post("/v1/citizen/alerts", citizen1(), { title: "Water outage" });
    expect(denied.statusCode).toBe(403);
    const res = await post("/v1/citizen/alerts", officer(), {
      title: "Water outage in Ward 7", category: "Utilities", targetAudience: "Ward 7", body: "Supply off 10am-2pm.",
    });
    expect(res.statusCode).toBe(202);
    alertId = res.json().id;
  });

  it("the draft is invisible to citizens (list and detail) but visible to staff with status 'draft'", async () => {
    await waitFor(async () => (await listRows("/v1/citizen/alerts", officer())).find((a) => a.id === alertId));
    const staff = (await listRows("/v1/citizen/alerts", officer())).find((a) => a.id === alertId)!;
    expect(staff.status).toBe("draft");
    expect(staff.publishedDate).toBe("");
    expect((await listRows("/v1/citizen/alerts", citizen1())).find((a) => a.id === alertId)).toBeUndefined();
    expect((await get(`/v1/citizen/alerts/${alertId}`, citizen1())).statusCode).toBe(404);
    expect((await get(`/v1/citizen/alerts/${alertId}`, officer())).statusCode).toBe(200);
  });

  it("citizen ?status=draft cannot widen their view; staff ?status is validated", async () => {
    expect((await listRows("/v1/citizen/alerts?status=draft", citizen1())).find((a) => a.id === alertId)).toBeUndefined();
    expect((await get("/v1/citizen/alerts?status=bogus", officer())).statusCode).toBe(400);
  });

  it("publishing: the creating officer 403, citizen 403, admin 202 -> citizen sees status 'active' with the web row shape", async () => {
    expect((await post(`/v1/citizen/alerts/${alertId}/publish`, officer())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/alerts/${alertId}/publish`, citizen1())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/alerts/${alertId}/publish`, admin())).statusCode).toBe(202);
    const row = await waitFor(async () => (await listRows("/v1/citizen/alerts", citizen1())).find((a) => a.id === alertId));
    expect(row).toEqual({
      id: alertId, title: "Water outage in Ward 7", category: "Utilities",
      publishedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), targetAudience: "Ward 7", status: "active",
    });
    expect((await get(`/v1/citizen/alerts/${alertId}`, citizen1())).json().data.body).toBe("Supply off 10am-2pm.");
  });

  it("publishing again is a 409 (state guard)", async () => {
    expect((await post(`/v1/citizen/alerts/${alertId}/publish`, admin())).statusCode).toBe(409);
  });

  it("a second officer (not the creator) publishes an officer's draft: 202, then a citizen sees it", async () => {
    const title = `Power cut ${randomUUID().slice(0, 8)}`;
    expect((await post("/v1/citizen/alerts", officer(), { title, category: "Utilities", targetAudience: "All" })).statusCode).toBe(202);
    const id = (await waitFor(async () => (await listRows("/v1/citizen/alerts?status=draft", officer())).find((a) => a.title === title))).id as string;
    expect((await post(`/v1/citizen/alerts/${id}/publish`, officer())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/alerts/${id}/publish`, officer2())).statusCode).toBe(202);
    const row = await waitFor(async () => (await listRows("/v1/citizen/alerts", citizen1())).find((a) => a.id === id));
    expect(row.status).toBe("active");
  });

  it("admin keeps full rights: admin publishes an officer draft, a citizen cannot withdraw, an officer can", async () => {
    const res = await post("/v1/citizen/alerts", officer(), { title: "Road closure", category: "Traffic", targetAudience: "All" });
    expect(res.statusCode).toBe(202);
    const id = (await waitFor(async () => (await listRows("/v1/citizen/alerts?status=draft", officer())).find((a) => a.title === "Road closure"))).id as string;
    expect((await post(`/v1/citizen/alerts/${id}/publish`, admin())).statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/alerts", citizen1())).find((a) => a.id === id));
    expect((await post(`/v1/citizen/alerts/${id}/withdraw`, citizen1())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/alerts/${id}/withdraw`, officer())).statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/alerts", citizen1())).every((a) => a.id !== id));
  });

  it("'expired' is derived from expires_at, never stored", async () => {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      await sql`UPDATE engagement.citizen_alerts SET expires_at = now() - interval '1 day' WHERE id = ${alertId}`;
    });
    const row = (await listRows("/v1/citizen/alerts", citizen1())).find((a) => a.id === alertId)!;
    expect(row.status).toBe("expired");
  });

  it("tenant isolation: tenant B never sees, reads or mutates tenant A's alert", async () => {
    expect((await listRows("/v1/citizen/alerts", citizenB())).find((a) => a.id === alertId)).toBeUndefined();
    expect((await listRows("/v1/citizen/alerts?status=all", adminB())).find((a) => a.id === alertId)).toBeUndefined();
    expect((await get(`/v1/citizen/alerts/${alertId}`, adminB())).statusCode).toBe(404);
    expect((await post(`/v1/citizen/alerts/${alertId}/withdraw`, adminB())).statusCode).toBe(404);
  });

  it("withdraw hides it from citizens; the audit trail recorded create/publish/withdraw", async () => {
    expect((await post(`/v1/citizen/alerts/${alertId}/withdraw`, citizen1())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/alerts/${alertId}/withdraw`, officer2())).statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/alerts", citizen1())).every((a) => a.id !== alertId));
    expect((await post(`/v1/citizen/alerts/${alertId}/withdraw`, admin())).statusCode).toBe(409);
    const actions = await auditActions(TENANT_A);
    expect(actions).toEqual(expect.arrayContaining(["citizen_alert:create", "citizen_alert:publish", "citizen_alert:withdraw"]));
  });

  it("validation: missing title and past expiry are 400; malformed id is 400; unauthenticated is 401", async () => {
    expect((await post("/v1/citizen/alerts", officer(), { category: "x" })).statusCode).toBe(400);
    expect((await post("/v1/citizen/alerts", officer(), { title: "t", expiresAt: "2020-01-01T00:00:00Z" })).statusCode).toBe(400);
    expect((await get("/v1/citizen/alerts/not-a-uuid", officer())).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/citizen/alerts" })).statusCode).toBe(401);
  });

  it("the old 501 stub is gone: the list answers 200 with an array (empty is a genuine empty)", async () => {
    const res = await get("/v1/citizen/alerts", citizenB());
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

// ═══════════════════════════════ notices ══════════════════════════════
describe("notices — GET/POST /v1/citizen/notices", () => {
  let noticeId: string;
  const GAZ = `GAZ/2026/${randomUUID().slice(0, 8)}`; // unique per run: the DB persists across runs

  it("an officer drafts; noticeNo is auto-generated when not supplied; a citizen cannot create", async () => {
    expect((await post("/v1/citizen/notices", citizen1(), { subject: "s", department: "d" })).statusCode).toBe(403);
    const res = await post("/v1/citizen/notices", officer(), {
      subject: "Public hearing on road widening", department: "Public Works", type: "public_hearing", body: "Hearing on 5 Nov.",
    });
    expect(res.statusCode).toBe(202);
    noticeId = res.json().id;
  });

  it("drafts never reach the default list; staff reach them with ?status=draft; a citizen's ?status=draft is ignored", async () => {
    await waitFor(async () => (await listRows("/v1/citizen/notices?status=draft", officer())).find((n) => n.id === noticeId));
    expect((await listRows("/v1/citizen/notices", officer())).find((n) => n.id === noticeId)).toBeUndefined();
    expect((await listRows("/v1/citizen/notices?status=draft", citizen1())).find((n) => n.id === noticeId)).toBeUndefined();
    expect((await get(`/v1/citizen/notices/${noticeId}`, citizen1())).statusCode).toBe(404);
  });

  it("publishing: creating officer 403, admin 202 -> citizen row has the exact web shape (type label, '' expiry)", async () => {
    expect((await post(`/v1/citizen/notices/${noticeId}/publish`, officer())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/notices/${noticeId}/publish`, admin())).statusCode).toBe(202);
    const row = await waitFor(async () => (await listRows("/v1/citizen/notices", citizen1())).find((n) => n.id === noticeId));
    expect(row).toEqual({
      id: noticeId, noticeNo: expect.stringMatching(/^NTC-\d{4}-[0-9A-F]{8}$/), subject: "Public hearing on road widening",
      department: "Public Works", published: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), expiry: "", type: "Public Hearing",
    });
  });

  it("a second officer (not the creator) publishes an officer's notice: 202, then a citizen sees it", async () => {
    const subject = `Water notice ${randomUUID().slice(0, 8)}`;
    expect((await post("/v1/citizen/notices", officer(), { subject, department: "Public Works", type: "tender" })).statusCode).toBe(202);
    const id = (await waitFor(async () => (await listRows("/v1/citizen/notices?status=draft", officer())).find((n) => n.subject === subject))).id as string;
    expect((await post(`/v1/citizen/notices/${id}/publish`, officer())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/notices/${id}/publish`, officer2())).statusCode).toBe(202);
    const row = await waitFor(async () => (await listRows("/v1/citizen/notices", citizen1())).find((n) => n.id === id));
    expect(row.subject).toBe(subject);
  });

  it("a duplicate supplied noticeNo is a 409; a supplied noticeNo is honoured", async () => {
    const first = await post("/v1/citizen/notices", officer(), { noticeNo: GAZ, subject: "Tender call", department: "Stores", type: "tender" });
    expect(first.statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/notices?status=draft", officer())).find((n) => n.noticeNo === GAZ));
    expect((await post("/v1/citizen/notices", officer(), { noticeNo: GAZ, subject: "Again", department: "Stores" })).statusCode).toBe(409);
  });

  it("tenant isolation + state guards + audit", async () => {
    expect((await listRows("/v1/citizen/notices?status=all", adminB())).find((n) => n.id === noticeId)).toBeUndefined();
    expect((await post(`/v1/citizen/notices/${noticeId}/withdraw`, adminB())).statusCode).toBe(404);
    expect((await post(`/v1/citizen/notices/${noticeId}/publish`, admin())).statusCode).toBe(409);
    expect((await post(`/v1/citizen/notices/${noticeId}/withdraw`, citizen1())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/notices/${noticeId}/withdraw`, officer())).statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/notices", citizen1())).every((n) => n.id !== noticeId));
    expect(await auditActions(TENANT_A)).toEqual(expect.arrayContaining(["citizen_notice:create", "citizen_notice:publish", "citizen_notice:withdraw"]));
  });

  it("validation: bad noticeNo / missing department are 400", async () => {
    expect((await post("/v1/citizen/notices", officer(), { noticeNo: "bad no!", subject: "s", department: "d" })).statusCode).toBe(400);
    expect((await post("/v1/citizen/notices", officer(), { subject: "s" })).statusCode).toBe(400);
  });
});

// ═══════════════════════════════ surveys ══════════════════════════════
describe("surveys — list/create/publish/respond, owner-scoped responses", () => {
  let surveyId: string;
  const questions = [
    { id: "q1", text: "How satisfied are you?", type: "rating", required: true },
    { id: "q2", text: "Preferred channel", type: "single_choice", options: ["portal", "mobile"] },
    { id: "q3", text: "Comments", type: "text" },
  ];

  it("an officer drafts; a citizen cannot; the draft is hidden from citizens everywhere", async () => {
    expect((await post("/v1/citizen/surveys", citizen1(), { surveyName: "x", questions })).statusCode).toBe(403);
    const res = await post("/v1/citizen/surveys", officer(), {
      surveyName: "Citizen service satisfaction", description: "Q4 pulse", questions,
      targetResponses: 2, startsOn: "2026-10-01", endsOn: "2026-10-31",
    });
    expect(res.statusCode).toBe(202);
    surveyId = res.json().id;
    await waitFor(async () => (await listRows("/v1/citizen/surveys", officer())).find((s) => s.id === surveyId));
    expect((await listRows("/v1/citizen/surveys", citizen1())).find((s) => s.id === surveyId)).toBeUndefined();
    expect((await get(`/v1/citizen/surveys/${surveyId}`, citizen1())).statusCode).toBe(404);
    expect((await post(`/v1/citizen/surveys/${surveyId}/responses`, citizen1(), { answers: { q1: 5 } })).statusCode).toBe(404);
  });

  it("admin publishes -> web row shape: responses 0, completion '0%', formatted period, status 'active'", async () => {
    expect((await post(`/v1/citizen/surveys/${surveyId}/publish`, officer())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/surveys/${surveyId}/publish`, admin())).statusCode).toBe(202);
    const row = await waitFor(async () => (await listRows("/v1/citizen/surveys", citizen1())).find((s) => s.id === surveyId));
    expect(row).toEqual({
      id: surveyId, surveyName: "Citizen service satisfaction", responses: 0, completion: "0%",
      period: "01 Oct 2026 – 31 Oct 2026", status: "active",
    });
    const detail = (await get(`/v1/citizen/surveys/${surveyId}`, citizen1())).json().data;
    expect(detail.questions).toHaveLength(3);
  });

  it("answers are validated against the survey's questions (400)", async () => {
    const bad = [
      { q2: "portal" },                 // required q1 missing
      { q1: 9 },                        // rating out of range
      { q1: 4, q2: "fax" },             // not an option
      { q1: 4, zz: "unknown question" },
    ];
    for (const answers of bad) {
      expect((await post(`/v1/citizen/surveys/${surveyId}/responses`, citizen1(), { answers })).statusCode).toBe(400);
    }
  });

  it("a citizen's response is stored under THEIR id; completion/response count update", async () => {
    expect((await post(`/v1/citizen/surveys/${surveyId}/responses`, citizen1(), { answers: { q1: 5, q2: "mobile", q3: "Good" } })).statusCode).toBe(202);
    const row = await waitFor(async () => {
      const r = (await listRows("/v1/citizen/surveys", citizen2())).find((s) => s.id === surveyId);
      return r && r.responses === 1 ? r : null;
    });
    expect(row.completion).toBe("50%");
  });

  it("a second response by the same citizen is a 409 (one per citizen)", async () => {
    expect((await post(`/v1/citizen/surveys/${surveyId}/responses`, citizen1(), { answers: { q1: 1 } })).statusCode).toBe(409);
  });

  it("OWNER-SCOPED: citizen 2 cannot read citizen 1's response; each sees only their own; officers' /mine is their own too", async () => {
    expect((await get(`/v1/citizen/surveys/${surveyId}/responses/mine`, citizen2())).statusCode).toBe(404);
    const mine = await get(`/v1/citizen/surveys/${surveyId}/responses/mine`, citizen1());
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.answers).toEqual({ q1: 5, q2: "mobile", q3: "Good" });
    expect((await get(`/v1/citizen/surveys/${surveyId}/responses/mine`, admin())).statusCode).toBe(404);
  });

  it("the raw-response list is admin-only; citizens and officers get 403", async () => {
    expect((await get(`/v1/citizen/surveys/${surveyId}/responses`, citizen1())).statusCode).toBe(403);
    expect((await get(`/v1/citizen/surveys/${surveyId}/responses`, officer())).statusCode).toBe(403);
    const list = await get(`/v1/citizen/surveys/${surveyId}/responses`, admin());
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].citizenId).toBe(CITIZEN_1);
  });

  it("tenant isolation: tenant B cannot see, answer, close or read responses of tenant A's survey", async () => {
    expect((await listRows("/v1/citizen/surveys?status=all", adminB())).find((s) => s.id === surveyId)).toBeUndefined();
    expect((await get(`/v1/citizen/surveys/${surveyId}`, citizenB())).statusCode).toBe(404);
    expect((await post(`/v1/citizen/surveys/${surveyId}/responses`, citizenB(), { answers: { q1: 5 } })).statusCode).toBe(404);
    expect((await post(`/v1/citizen/surveys/${surveyId}/close`, adminB())).statusCode).toBe(404);
    expect((await get(`/v1/citizen/surveys/${surveyId}/responses`, adminB())).statusCode).toBe(404);
  });

  it("closing: admin-only; once completed, answering is a 409 and a second close is a 409; audit recorded", async () => {
    expect((await post(`/v1/citizen/surveys/${surveyId}/close`, officer())).statusCode).toBe(403);
    expect((await post(`/v1/citizen/surveys/${surveyId}/close`, admin())).statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/surveys", citizen2())).find((s) => s.id === surveyId && s.status === "completed"));
    expect((await post(`/v1/citizen/surveys/${surveyId}/responses`, citizen2(), { answers: { q1: 3 } })).statusCode).toBe(409);
    expect((await post(`/v1/citizen/surveys/${surveyId}/close`, admin())).statusCode).toBe(409);
    expect(await auditActions(TENANT_A)).toEqual(expect.arrayContaining([
      "citizen_survey:create", "citizen_survey:publish", "citizen_survey:close", "citizen_survey_response:create",
    ]));
  });

  it("validation: choice question without options, duplicate ids, inverted dates are 400", async () => {
    expect((await post("/v1/citizen/surveys", officer(), { surveyName: "s", questions: [{ id: "a", text: "t", type: "single_choice" }] })).statusCode).toBe(400);
    expect((await post("/v1/citizen/surveys", officer(), { surveyName: "s", questions: [{ id: "a", text: "t", type: "text" }, { id: "a", text: "u", type: "text" }] })).statusCode).toBe(400);
    expect((await post("/v1/citizen/surveys", officer(), { surveyName: "s", questions: [{ id: "a", text: "t", type: "text" }], startsOn: "2026-10-31", endsOn: "2026-10-01" })).statusCode).toBe(400);
  });
});

// ═════════════════ maker-checker + create-conflict (review round 1) ═════════════════
const ADMIN_2 = "77777777-0000-4000-8000-000000000041";
const admin2 = () => hdr(tok(TENANT_A, ADMIN_2, ["citizen_admin"]));
const settle = () => new Promise((r) => setTimeout(r, 400));
const cmd = (topic: string, actorId: string, payload: Record<string, unknown>) =>
  queue.publish(topic, {
    messageId: randomUUID(), type: topic, tenantId: TENANT_A, actorId,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: TENANT_A, ...payload },
  });

describe("maker-checker: the creator of a draft can never publish it", () => {
  it("alert: admin creates -> own publish is 403 at the route AND a bypassing command is a no-op in the consumer; a different admin can publish", async () => {
    const created = await post("/v1/citizen/alerts", admin(), { title: "Self-publish attempt" });
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;
    await waitFor(async () => (await listRows("/v1/citizen/alerts?status=draft", admin())).find((a) => a.id === id));
    expect((await post(`/v1/citizen/alerts/${id}/publish`, admin())).statusCode).toBe(403);
    await cmd(COMMANDS.alertPublish, ADMIN, { id });
    await settle();
    expect((await listRows("/v1/citizen/alerts?status=draft", admin())).find((a) => a.id === id)).toBeDefined();
    expect((await post(`/v1/citizen/alerts/${id}/publish`, admin2())).statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/alerts", citizen1())).find((a) => a.id === id));
  });

  it("notice: same admin create -> publish is blocked in route and consumer; another admin publishes", async () => {
    const created = await post("/v1/citizen/notices", admin(), { subject: "Self-publish notice", department: "Estates" });
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;
    await waitFor(async () => (await listRows("/v1/citizen/notices?status=draft", admin())).find((n) => n.id === id));
    expect((await post(`/v1/citizen/notices/${id}/publish`, admin())).statusCode).toBe(403);
    await cmd(COMMANDS.noticePublish, ADMIN, { id });
    await settle();
    expect((await listRows("/v1/citizen/notices?status=draft", admin())).find((n) => n.id === id)).toBeDefined();
    expect((await post(`/v1/citizen/notices/${id}/publish`, admin2())).statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/notices", citizen1())).find((n) => n.id === id));
  });

  it("survey: same admin create -> publish is blocked in route and consumer; another admin publishes", async () => {
    const created = await post("/v1/citizen/surveys", admin(), {
      surveyName: "Self-publish survey", questions: [{ id: "q1", text: "rate", type: "rating", required: true }],
    });
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;
    await waitFor(async () => (await listRows("/v1/citizen/surveys?status=draft", admin())).find((s) => s.id === id));
    expect((await post(`/v1/citizen/surveys/${id}/publish`, admin())).statusCode).toBe(403);
    await cmd(COMMANDS.surveyPublish, ADMIN, { id });
    await settle();
    expect((await listRows("/v1/citizen/surveys?status=draft", admin())).find((s) => s.id === id)).toBeDefined();
    expect((await post(`/v1/citizen/surveys/${id}/publish`, admin2())).statusCode).toBe(202);
    await waitFor(async () => (await listRows("/v1/citizen/surveys", citizen1())).find((s) => s.id === id));
  });
});

describe("notice create: a unique violation is not audited as success", () => {
  it("two concurrent creates with the same noticeNo insert one row and audit exactly one create", async () => {
    const NO = `RACE/${randomUUID().slice(0, 8)}`;
    const before = (await auditActions(TENANT_A)).filter((a) => a === "citizen_notice:create").length;
    const a = randomUUID(); const b = randomUUID();
    await Promise.all([
      cmd(COMMANDS.noticeCreate, OFFICER, { id: a, noticeNo: NO, subject: "first", department: "Estates" }),
      cmd(COMMANDS.noticeCreate, OFFICER, { id: b, noticeNo: NO, subject: "second", department: "Estates" }),
    ]);
    await waitFor(async () => (await listRows("/v1/citizen/notices?status=draft", officer())).find((n) => n.noticeNo === NO));
    await settle();
    expect((await listRows("/v1/citizen/notices?status=draft", officer())).filter((n) => n.noticeNo === NO)).toHaveLength(1);
    const after = (await auditActions(TENANT_A)).filter((a2) => a2 === "citizen_notice:create").length;
    expect(after - before).toBe(1);
  });
});
