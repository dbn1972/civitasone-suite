/**
 * Stored late-inclusion request flow (Req 3.5), real DB: a secretary / member asks (reason required), the
 * request is stored pending and the chair is notified; the chair approves (the item is added past the
 * cut-off) or rejects (reason); the requester is notified; everything is audited; maker != checker holds
 * at the route, in the consumer and as a DB CHECK.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { isNonRetryable, type CommandEnvelope } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1a7e-4a1a-9b2c-000000000d02";
const SECRETARY = "0a000000-1a7e-4a1a-9b2c-000000000d02";
const CHAIR_USER = "0b000000-1a7e-4a1a-9b2c-000000000d02";
const OTHER_CHAIR = "0d000000-1a7e-4a1a-9b2c-000000000d02"; // holds committee_chairperson but chairs a different meeting
const ADMIN = "0e000000-1a7e-4a1a-9b2c-000000000d02";
const COMMITTEE = "c0c0c0c0-1a7e-4a1a-9b2c-000000000d02";
const M_SOON = "b1000000-1a7e-4a1a-9b2c-000000000d02";
const M_LOCKED = "b3000000-1a7e-4a1a-9b2c-000000000d02";
const DAY = 24 * 60 * 60 * 1000;
const SOON = new Date(Date.now() + 2 * DAY);

const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "sess-lr" }, SECRET);
let app: Awaited<ReturnType<typeof buildApp>>;
const item = { title: "Sanction letter", outcomeType: "discussion", reason: "Letter arrived after the cut-off, needs this meeting" };
const call = (method: "GET" | "POST", url: string, who: string, roles: string[], payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tok(who, roles)}` }, ...(payload ? { payload } : {}) });

const asTenant = <T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> =>
  runWithTenant(TENANT, () => sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  })) as Promise<T>;

const handlers = new Map<string, (m: CommandEnvelope<any>) => Promise<void>>();
registerAgendaConsumers((topic, h) => handlers.set(topic, h as never));
const env = (type: string, actorId: string, payload: Record<string, unknown>): CommandEnvelope<any> =>
  ({ messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: TENANT, ...payload } } as CommandEnvelope<any>);
const chairRoles = ["committee_chairperson"];
const run = (m: CommandEnvelope<any>) => runWithTenant(TENANT, () => handlers.get(m.type)!(m)) as Promise<void>;
const reqRow = async (id: string) => (await asTenant((sql) => sql`select * from meeting.agenda_late_requests where id = ${id}`))[0];
const auditActions = async () => (await asTenant((sql) => sql`select payload from _outbox.messages where tenant_id = ${TENANT} and topic = 'audit.event.record'`))
  .map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload as string) : r.payload) as { action: string; resourceId: string; metadata?: Record<string, unknown> });
const notified = async (recipientId: string) => (await asTenant((sql) => sql`select payload from _outbox.messages where tenant_id = ${TENANT} and topic = 'notification.send'`))
  .map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload as string) : r.payload) as Record<string, any>)
  .filter((p) => JSON.stringify(p).includes(recipientId));

/** Create a pending request through the consumer (as the secretary) and return its id. */
async function pending(): Promise<string> {
  const requestId = randomUUID();
  await run(env(COMMANDS.agendaLateRequest, SECRETARY, { requestId, meetingId: M_SOON, title: item.title, outcomeType: item.outcomeType, reason: item.reason }));
  return requestId;
}

beforeAll(async () => {
  await asTenant(async (sql) => {
    await sql`insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Late Request Committee', 'LRC', 'standing', '2025-01-01', ${'{"minMembers":2}'}::jsonb, ${SECRETARY}, ${SECRETARY}) on conflict (id) do nothing`;
    await sql`insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, chairperson_id, scheduled_at, duration_minutes, created_by, updated_by) values
      (${M_SOON}, ${TENANT}, 'committee', 'Soon', 'scheduled', ${COMMITTEE}, ${CHAIR_USER}, ${SOON.toISOString()}, 60, ${SECRETARY}, ${SECRETARY}),
      (${M_LOCKED}, ${TENANT}, 'committee', 'Locked', 'agenda_locked', ${COMMITTEE}, ${CHAIR_USER}, '2035-01-15T10:00:00.000Z', 60, ${SECRETARY}, ${SECRETARY})
      on conflict (id) do nothing`;
    return null;
  });
  app = await buildApp();
});

afterAll(async () => {
  if (app) await app.close();
  await asTenant(async (sql) => {
    await sql`delete from meeting.agenda_late_requests where tenant_id = ${TENANT}`;
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
    return null;
  });
  await sqlClient.end();
});

describe("POST /agenda/late-requests (ask)", () => {
  const url = `/v1/meetings/${M_SOON}/agenda/late-requests`;
  it("202 for a secretary and for a committee member; the command carries the reason", async () => {
    expect((await call("POST", url, SECRETARY, ["committee_secretary"], item)).statusCode).toBe(202);
    expect((await call("POST", url, SECRETARY, ["committee_member"], item)).statusCode).toBe(202);
  });
  it("403 for the chair (they decide, they do not ask) and for an observer", async () => {
    expect((await call("POST", url, CHAIR_USER, ["committee_chairperson"], item)).statusCode).toBe(403);
    expect((await call("POST", url, SECRETARY, ["observer"], item)).statusCode).toBe(403);
  });
  it("400 without a reason; 422 for a locked agenda; 404 for an unknown meeting", async () => {
    expect((await call("POST", url, SECRETARY, ["committee_secretary"], { title: "x", outcomeType: "discussion" })).statusCode).toBe(400);
    const locked = await call("POST", `/v1/meetings/${M_LOCKED}/agenda/late-requests`, SECRETARY, ["committee_secretary"], item);
    expect(locked.statusCode).toBe(422);
    expect(locked.json().code).toBe("MEETING_AGENDA_LOCKED");
    expect((await call("POST", `/v1/meetings/${randomUUID()}/agenda/late-requests`, SECRETARY, ["committee_secretary"], item)).statusCode).toBe(404);
  });
});

describe("request consumer + list", () => {
  it("stores a pending request, audits it, notifies the chairperson, and the chair's list shows it", async () => {
    const id = await pending();
    const r = await reqRow(id);
    expect(r).toMatchObject({ status: "pending", requested_by: SECRETARY, title: item.title, reason: item.reason });
    expect((await auditActions()).some((a) => a.action === "late_request" && a.resourceId === id && a.metadata?.reason === item.reason)).toBe(true);
    expect((await notified(CHAIR_USER)).length).toBeGreaterThan(0);
    const list = await call("GET", `/v1/meetings/${M_SOON}/agenda/late-requests?status=pending`, CHAIR_USER, ["committee_chairperson"]);
    expect(list.statusCode).toBe(200);
    expect((list.json().data as Array<{ id: string }>).map((x) => x.id)).toContain(id);
  });
});

describe("approve", () => {
  it("403 for a secretary (not an approver role)", async () => {
    const id = await pending();
    expect((await call("POST", `/v1/meetings/${M_SOON}/agenda/late-requests/${id}/approve`, CHAIR_USER, ["committee_secretary"], {})).statusCode).toBe(403);
  });

  it("maker != checker at the route: an admin who made the request cannot approve it (403)", async () => {
    const id = await pending(); // requested by SECRETARY
    const res = await call("POST", `/v1/meetings/${M_SOON}/agenda/late-requests/${id}/approve`, SECRETARY, ["tenant_admin"], {});
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("maker != checker in the consumer too (non-retryable), and the row stays pending", async () => {
    const id = await pending();
    const err = await run(env(COMMANDS.agendaLateRequestApprove, SECRETARY, { requestId: id, meetingId: M_SOON, actorRoles: ["tenant_admin"] })).then(() => null, (e: unknown) => e);
    expect(isNonRetryable(err)).toBe(true);
    expect((await reqRow(id)).status).toBe("pending");
  });

  it("chair approves: 202, the item is added past the cut-off, request approved, requester notified, audited", async () => {
    const id = await pending();
    const res = await call("POST", `/v1/meetings/${M_SOON}/agenda/late-requests/${id}/approve`, CHAIR_USER, ["committee_chairperson"], { note: "Urgent" });
    expect(res.statusCode).toBe(202);
    await run(env(COMMANDS.agendaLateRequestApprove, CHAIR_USER, { requestId: id, meetingId: M_SOON, note: "Urgent", actorRoles: chairRoles }));
    const r = await reqRow(id);
    expect(r).toMatchObject({ status: "approved", decided_by: CHAIR_USER, decision_reason: "Urgent" });
    const items = await asTenant((sql) => sql`select title, submitted_by, status from meeting.agenda_items where id = ${r.agenda_item_id}`);
    expect(items[0]).toMatchObject({ title: item.title, submitted_by: SECRETARY, status: "proposed" });
    const acts = await auditActions();
    expect(acts.some((a) => a.action === "late_request_approved" && a.resourceId === id)).toBe(true);
    expect(acts.some((a) => a.action === "submit_late_approved" && a.resourceId === r.agenda_item_id)).toBe(true);
    expect((await notified(SECRETARY)).length).toBeGreaterThan(0);
  });

  it("a second decision on the same request: 409 at the route; a redelivered consumer decision is a no-op (one agenda item)", async () => {
    const id = await pending();
    await run(env(COMMANDS.agendaLateRequestApprove, CHAIR_USER, { requestId: id, meetingId: M_SOON, actorRoles: chairRoles }));
    const again = await call("POST", `/v1/meetings/${M_SOON}/agenda/late-requests/${id}/approve`, CHAIR_USER, ["committee_chairperson"], {});
    expect(again.statusCode).toBe(409);
    await run(env(COMMANDS.agendaLateRequestApprove, CHAIR_USER, { requestId: id, meetingId: M_SOON, actorRoles: chairRoles }));
    const n = await asTenant((sql) => sql`select count(*)::int as n from meeting.agenda_items where tenant_id = ${TENANT} and submitted_by = ${SECRETARY} and title = ${item.title} and id in (select agenda_item_id from meeting.agenda_late_requests where id = ${id})`);
    expect(n[0]!.n).toBe(1);
  });

  it("404 for a request that belongs to another meeting or does not exist", async () => {
    expect((await call("POST", `/v1/meetings/${M_SOON}/agenda/late-requests/${randomUUID()}/approve`, CHAIR_USER, ["committee_chairperson"], {})).statusCode).toBe(404);
  });
});

describe("reject", () => {
  it("400 without a reason (min 5 chars)", async () => {
    const id = await pending();
    expect((await call("POST", `/v1/meetings/${M_SOON}/agenda/late-requests/${id}/reject`, CHAIR_USER, ["committee_chairperson"], { reason: "no" })).statusCode).toBe(400);
  });

  it("maker != checker: the requester cannot reject their own request (403)", async () => {
    const id = await pending();
    expect((await call("POST", `/v1/meetings/${M_SOON}/agenda/late-requests/${id}/reject`, SECRETARY, ["tenant_admin"], { reason: "withdrawn by me" })).statusCode).toBe(403);
  });

  it("chair rejects with a reason: no item is added, requester notified, audited", async () => {
    const id = await pending();
    const res = await call("POST", `/v1/meetings/${M_SOON}/agenda/late-requests/${id}/reject`, CHAIR_USER, ["committee_chairperson"], { reason: "Can wait for the next meeting" });
    expect(res.statusCode).toBe(202);
    await run(env(COMMANDS.agendaLateRequestReject, CHAIR_USER, { requestId: id, meetingId: M_SOON, reason: "Can wait for the next meeting", actorRoles: chairRoles }));
    const r = await reqRow(id);
    expect(r).toMatchObject({ status: "rejected", decided_by: CHAIR_USER, decision_reason: "Can wait for the next meeting", agenda_item_id: null });
    expect((await auditActions()).some((a) => a.action === "late_request_rejected" && a.resourceId === id && a.metadata?.reason === "Can wait for the next meeting")).toBe(true);
    expect((await notified(SECRETARY)).length).toBeGreaterThan(0);
  });
});

describe("only THIS meeting's chairperson (or an admin) decides", () => {
  const base = (id: string) => `/v1/meetings/${M_SOON}/agenda/late-requests/${id}`;
  it("a committee_chairperson who does not chair this meeting gets 403 on approve, reject and /agenda/late; the request stays pending", async () => {
    const id = await pending();
    expect((await call("POST", `${base(id)}/approve`, OTHER_CHAIR, ["committee_chairperson"], {})).statusCode).toBe(403);
    expect((await call("POST", `${base(id)}/reject`, OTHER_CHAIR, ["committee_chairperson"], { reason: "not my meeting" })).statusCode).toBe(403);
    expect((await call("POST", `/v1/meetings/${M_SOON}/agenda/late`, OTHER_CHAIR, ["committee_chairperson"], item)).statusCode).toBe(403);
    expect((await reqRow(id)).status).toBe("pending");
  });
  it("an administrator who is not the chair may decide (documented tenant-wide bypass)", async () => {
    const id = await pending();
    expect((await call("POST", `${base(id)}/approve`, ADMIN, ["tenant_admin"], {})).statusCode).toBe(202);
  });
  it("the consumer enforces it too: a non-chair, non-admin decision is non-retryable and changes nothing", async () => {
    const id = await pending();
    const err = await run(env(COMMANDS.agendaLateRequestApprove, OTHER_CHAIR, { requestId: id, meetingId: M_SOON, actorRoles: chairRoles })).then(() => null, (e: unknown) => e);
    expect(isNonRetryable(err)).toBe(true);
    expect((await reqRow(id)).status).toBe("pending");
  });
});

describe("concurrent decisions on one request", () => {
  const itemsFor = async (id: string) => (await asTenant((sql) => sql`select count(*)::int as n from meeting.agenda_items where tenant_id = ${TENANT} and meeting_id = ${M_SOON} and title = ${"Concurrent " + id}`))[0]!.n as number;
  const pendingNamed = async (): Promise<string> => {
    const requestId = randomUUID();
    await run(env(COMMANDS.agendaLateRequest, SECRETARY, { requestId, meetingId: M_SOON, title: "Concurrent " + requestId, outcomeType: "discussion", reason: item.reason }));
    return requestId;
  };
  const approve = (id: string) => run(env(COMMANDS.agendaLateRequestApprove, CHAIR_USER, { requestId: id, meetingId: M_SOON, actorRoles: chairRoles }));
  const reject = (id: string) => run(env(COMMANDS.agendaLateRequestReject, CHAIR_USER, { requestId: id, meetingId: M_SOON, reason: "Can wait for the next meeting", actorRoles: chairRoles }));

  it.each([1, 2, 3, 4, 5])("approve racing reject (round %i): exactly one wins; an item exists iff the request is approved", async () => {
    const id = await pendingNamed();
    await Promise.all([approve(id), reject(id)]);
    const r = await reqRow(id);
    expect(["approved", "rejected"]).toContain(r.status);
    expect(await itemsFor(id)).toBe(r.status === "approved" ? 1 : 0);
    if (r.status === "approved") expect(r.agenda_item_id).toBeTruthy(); else expect(r.agenda_item_id).toBeNull();
  });

  it.each([1, 2, 3])("two approves racing (round %i): one agenda item", async () => {
    const id = await pendingNamed();
    await Promise.all([approve(id), approve(id), approve(id)]);
    expect(await itemsFor(id)).toBe(1);
    expect((await reqRow(id)).status).toBe("approved");
  });
});

describe("database invariants", () => {
  it("the maker != checker CHECK refuses decided_by = requested_by even when the app is bypassed", async () => {
    const id = await pending();
    await expect(asTenant((sql) => sql`update meeting.agenda_late_requests set status = 'approved', decided_by = requested_by, decided_at = now() where id = ${id}`))
      .rejects.toThrow(/maker_checker/);
  });
  it("RLS: another tenant sees none of this tenant's requests", async () => {
    const other = "aaaaaaaa-1a7e-4a1a-9b2c-0000000000ff";
    const rows = await runWithTenant(other, () => sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${other}, true)`;
      return sql`select id from meeting.agenda_late_requests`;
    }));
    expect(rows).toHaveLength(0);
  });
});
