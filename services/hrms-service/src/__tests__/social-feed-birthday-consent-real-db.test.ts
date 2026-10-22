/**
 * GAP-HR-SOCIAL-FEED-01 (DPDP) -- real DB, real HTTP, in-memory queue -> real social consumer.
 *
 *  - GET /v1/hrms/social/feed never lists an employee who has not opted in
 *    (the feed route itself, not just the /birthdays/today twin),
 *  - an employee can opt in / out for THEMSELVES via PUT /v1/hrms/me/birthday-sharing
 *    (202 -> consumer: guarded write + audit in one transaction) and the feed follows,
 *  - consent is self-only: no employee id is accepted, HR has no on-behalf setter,
 *  - a feed read that discloses birthday entries is audited (count only), one that
 *    discloses none is not,
 *  - "today" is the IST date.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc, withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerSocialConsumers } from "../modules/social/consumer.js";

// vitest.config.ts injects JWT_SECRET for every service suite; no literal here (gitleaks scans every commit)
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const SEED_ACTOR = randomUUID();
const DEPT_ID = randomUUID();
const DESIG_ID = randomUUID();

const OPT_IN = { id: randomUUID(), sub: randomUUID(), name: "Consent Opted-In Priya" };
const NOT_OPT = { id: randomUUID(), sub: randomUUID(), name: "Consent NotOpted Rahul" };
const VIEWER = { id: randomUUID(), sub: randomUUID(), name: "Consent Viewer Meera" };
const HR_SUB = randomUUID(); // an HR user with NO linked employee record

const tok = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-consent" }, SECRET, 3600)}`,
});
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);
const drain = () => (queue as unknown as MemoryQueue).drain();
let app: FastifyInstance;

async function send(method: "GET" | "PUT", url: string, headers: Record<string, string>, payload?: unknown) {
  const res = await app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await drain();
  return res;
}

async function outbox(): Promise<Array<{ topic: string; actorId: string | null; payload: Record<string, any> }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return rows as Array<{ topic: string; actorId: string | null; payload: Record<string, any> }>;
}
const consentAudits = async () => (await outbox()).filter((r) => r.topic === "audit.event.record" && r.payload?.action === "birthday_sharing_set");
const disclosureAudits = async () => (await outbox()).filter((r) => r.topic === "audit.event.record" && r.payload?.resourceType === "social_feed_birthdays");

async function seed(e: { id: string; sub: string; name: string }, no: string, birthdayToday: boolean, share: boolean) {
  // "today" is the IST date, derived the same way the route derives it.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, date_of_birth,
       status, share_birthday, user_ref, created_by, updated_by)
    VALUES
      (${e.id}, ${TENANT}, ${no}, ${e.name}, ${DEPT_ID}, ${DESIG_ID}, '2019-01-01',
       ((NOW() AT TIME ZONE 'Asia/Kolkata')::date + ${birthdayToday ? 0 : 3}::int) - INTERVAL '31 years',
       'confirmed', ${share}, ${e.sub}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
}

const flag = async (id: string) =>
  (await asTenant((tx) => tx`SELECT share_birthday FROM employee.hrms_employees WHERE id = ${id}`) as unknown as Array<{ share_birthday: boolean }>)[0]!.share_birthday;

const birthdayNames = (body: { data: Array<{ type: string; name?: string }> }) =>
  body.data.filter((i) => i.type === "birthday").map((i) => i.name);

beforeAll(async () => {
  app = await buildApp();
  registerSocialConsumers(queue);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'CNS', 'Consent Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'CNS', 'Consent Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await seed(OPT_IN, "CNS-1", true, true);
  await seed(NOT_OPT, "CNS-2", true, false);
  await seed(VIEWER, "CNS-3", false, false);
});

afterAll(async () => {
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/social/feed -- birthday consent", () => {
  it("lists the opted-in employee on their (IST) birthday and NEVER the one who has not opted in", async () => {
    const res = await send("GET", "/v1/hrms/social/feed", tok(VIEWER.sub, ["employee"]));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(birthdayNames(body)).toEqual([OPT_IN.name]);
    expect(res.body).not.toContain(NOT_OPT.name);
    expect(body.counts.birthdaysToday).toBe(1);
    const entry = body.data.find((i: { type: string }) => i.type === "birthday");
    expect(entry).toMatchObject({ department: "Consent Dept", designation: "Consent Desig" });
    expect(entry.dateOfBirth).toBeUndefined();
  });

  it("rejects a request with no token and one whose role is outside the audience", async () => {
    const anon = await app.inject({ method: "GET", url: "/v1/hrms/social/feed" });
    expect(anon.statusCode).toBe(401);
    const guest = await app.inject({ method: "GET", url: "/v1/hrms/social/feed", headers: tok(randomUUID(), ["guest"]) });
    expect(guest.statusCode).toBe(403);
  });

  it("audits a feed read that discloses birthday entries -- count only, no names or dates", async () => {
    const audits = await disclosureAudits();
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const ev = audits[audits.length - 1]!;
    expect(ev.actorId).toBe(VIEWER.sub);
    expect(ev.payload).toMatchObject({ service: "hrms", action: "read", resourceType: "social_feed_birthdays", outcome: "success", rowCount: 1, surface: "social_feed" });
    const serialised = JSON.stringify(ev.payload);
    expect(serialised).not.toContain(OPT_IN.name);
    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("PUT/GET /v1/hrms/me/birthday-sharing -- the employee's own consent", () => {
  it("GET reports the caller's own current choice (off by default)", async () => {
    const res = await send("GET", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["employee"]));
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ linked: true, shareBirthday: false });
  });

  it("opting in: 202, the consumer writes the flag + exactly one audit event, and the feed then lists them", async () => {
    const before = (await consentAudits()).length;
    const res = await send("PUT", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["employee"]), { share: true });
    expect(res.statusCode, res.body).toBe(202);
    expect(await flag(NOT_OPT.id)).toBe(true);

    const audits = await consentAudits();
    expect(audits).toHaveLength(before + 1);
    const ev = audits[audits.length - 1]!;
    expect(ev.actorId).toBe(NOT_OPT.sub);
    expect(ev.payload).toMatchObject({ resourceType: "employee", resourceId: NOT_OPT.id, outcome: "success", metadata: { share: true } });

    const feed = await send("GET", "/v1/hrms/social/feed", tok(VIEWER.sub, ["employee"]));
    expect(birthdayNames(feed.json()).sort()).toEqual([NOT_OPT.name, OPT_IN.name].sort());
    const me = await send("GET", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["employee"]));
    expect(me.json().data.shareBirthday).toBe(true);
  });

  it("setting the value it already has writes nothing more (no second audit event)", async () => {
    const before = (await consentAudits()).length;
    const res = await send("PUT", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["employee"]), { share: true });
    expect(res.statusCode).toBe(202);
    expect(await consentAudits()).toHaveLength(before);
  });

  it("opting out removes them from the feed again and is audited", async () => {
    const before = (await consentAudits()).length;
    const res = await send("PUT", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["employee"]), { share: false });
    expect(res.statusCode).toBe(202);
    expect(await flag(NOT_OPT.id)).toBe(false);
    const audits = await consentAudits();
    expect(audits).toHaveLength(before + 1);
    expect(audits[audits.length - 1]!.payload.metadata).toEqual({ share: false });
    const feed = await send("GET", "/v1/hrms/social/feed", tok(VIEWER.sub, ["employee"]));
    expect(birthdayNames(feed.json())).toEqual([OPT_IN.name]);
  });

  it("is self-only: a body naming another employee is refused and nobody else's consent changes", async () => {
    const res = await send("PUT", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["employee"]), { share: true, employeeId: VIEWER.id });
    expect(res.statusCode).toBe(400);
    expect(await flag(VIEWER.id)).toBe(false);
    expect(await flag(NOT_OPT.id)).toBe(false);
  });

  it("gives HR no on-behalf setter: an HR user with no linked employee record is refused (403), flags untouched", async () => {
    const res = await send("PUT", "/v1/hrms/me/birthday-sharing", tok(HR_SUB, ["hr_admin"]), { share: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("EMPLOYEE_NOT_LINKED");
    expect(await flag(OPT_IN.id)).toBe(true);
    expect(await flag(NOT_OPT.id)).toBe(false);
    expect(await flag(VIEWER.id)).toBe(false);
    // and the read side reports "not linked" rather than erroring
    const get = await send("GET", "/v1/hrms/me/birthday-sharing", tok(HR_SUB, ["hr_admin"]));
    expect(get.json().data).toEqual({ linked: false, shareBirthday: false });
  });

  it("validates the body and the audience", async () => {
    expect((await send("PUT", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["employee"]), { share: "yes" })).statusCode).toBe(400);
    expect((await send("PUT", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["employee"]), {})).statusCode).toBe(400);
    expect((await send("PUT", "/v1/hrms/me/birthday-sharing", tok(NOT_OPT.sub, ["guest"]), { share: true })).statusCode).toBe(403);
    const anon = await app.inject({ method: "PUT", url: "/v1/hrms/me/birthday-sharing", payload: { share: true } });
    expect(anon.statusCode).toBe(401);
  });
});

describe("a feed read that discloses no birthday entries is not audited as a disclosure", () => {
  it("after everyone opts out, reading the feed adds no social_feed_birthdays audit event", async () => {
    await send("PUT", "/v1/hrms/me/birthday-sharing", tok(OPT_IN.sub, ["employee"]), { share: false });
    expect(await flag(OPT_IN.id)).toBe(false);
    const before = (await disclosureAudits()).length;
    const feed = await send("GET", "/v1/hrms/social/feed", tok(VIEWER.sub, ["employee"]));
    expect(birthdayNames(feed.json())).toEqual([]);
    expect(feed.json().counts.birthdaysToday).toBe(0);
    expect(await disclosureAudits()).toHaveLength(before);
  });
});
