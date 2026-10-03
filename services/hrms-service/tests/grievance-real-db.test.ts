/**
 * GAP-HR-GRIEVANCE-01/02/03/06 -- real-DB, end to end through the Fastify app
 * and the in-memory queue: per-tenant GRV/YYYY/NNNN numbering (including under
 * concurrency), register/assign/dispose commands with audit, the DPDP-coarse
 * list vs. the detail read, role + tenant isolation, and the race-safe
 * conditional dispose (migration 0177).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerGrievanceConsumers } from "../src/modules/grievance/consumer.js";
import { hrmsGrievances, hrmsGrievanceEvents, hrmsGrievanceSeq } from "../src/modules/grievance/schema.js";
import * as repo from "../src/modules/grievance/repo.js";
import { istYear } from "../src/modules/grievance/domain.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";

// Identity-service is not running here: stand in for the role lookup (keyed by the
// assignee's user id) so the HR-role rule on assignment is exercised for real.
const { rolesByUser } = vi.hoisted(() => ({ rolesByUser: new Map<string, string[] | undefined>() }));
vi.mock("../src/shared/identity-client.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  fetchUserRoleKeys: async (_t: string, userId: string) => rolesByUser.get(userId),
}));

registerGrievanceConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const COMPLAINANT_USER = randomUUID(); // the user account of grievant "A. Kumar"
const OFFICER_USER = randomUUID();     // the user account of HR officer "R. Singh"
const PLAIN_USER = randomUUID();       // a user account with NO HR role
const deptId = randomUUID();
const desigId = randomUUID();
const YEAR = istYear(new Date());

const headers = (roles = ["hr_officer"], tenant = TENANT, extra: Record<string, string> = {}, sub = ACTOR) => ({
  authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
  ...extra,
});

let app: FastifyInstance;
const asTenant = <T>(tenant: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction(fn));

async function seedEmployee(tenant: string, name: string, userRef: string | null = null): Promise<string> {
  const id = randomUUID();
  await asTenant(tenant, async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: tenant, employeeNo: `GR-${id.slice(0, 8)}`, fullName: name,
      departmentId: deptId, designationId: desigId, dateOfJoining: "2024-01-01",
      status: "confirmed", employeeType: "permanent", basicMinor: 5_000_000n, userRef, createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  return id;
}

async function audits(tenant: string, resourceId: string): Promise<string[]> {
  const rows = await asTenant(tenant, (tx) => tx.execute(sql`
    SELECT payload FROM _outbox.messages
    WHERE topic = 'audit.event.record' AND payload->>'resourceType' = 'grievance' AND payload->>'resourceId' = ${resourceId}
    ORDER BY created_at`)) as unknown as Array<{ payload: { action: string } }>;
  return rows.map((r) => r.payload.action);
}

async function register(employeeId: string, over: Record<string, unknown> = {}, h = headers()) {
  const r = await app.inject({
    method: "POST", url: "/v1/hrms/grievances", headers: h,
    payload: { employeeId, category: "pay_allowances", subject: "DA arrears", description: "March DA arrears are missing", ...over },
  });
  return r;
}

let grievant: string;
let officer: string;
let plain: string;

beforeAll(async () => {
  app = await buildApp();
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, async (tx) => {
      await tx.insert(hrmsDepartments).values({ id: t === TENANT ? deptId : randomUUID(), tenantId: t, code: `G${t.slice(0, 6)}`, name: "Revenue", createdBy: ACTOR, updatedBy: ACTOR }).onConflictDoNothing();
    });
  }
  // desig/dept for the second tenant are not needed beyond isolation checks
  await asTenant(TENANT, async (tx) => {
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `GD${TENANT.slice(0, 6)}`, name: "Clerk", createdBy: ACTOR, updatedBy: ACTOR });
  });
  grievant = await seedEmployee(TENANT, "A. Kumar", COMPLAINANT_USER);
  officer = await seedEmployee(TENANT, "R. Singh", OFFICER_USER);
  plain = await seedEmployee(TENANT, "P. Plain", PLAIN_USER);
  rolesByUser.set(OFFICER_USER, ["hr_officer"]);
  rolesByUser.set(PLAIN_USER, ["employee"]);
});

afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, async (tx) => {
      await tx.delete(hrmsGrievanceEvents).where(eq(hrmsGrievanceEvents.tenantId, t));
      await tx.delete(hrmsGrievances).where(eq(hrmsGrievances.tenantId, t));
      await tx.delete(hrmsGrievanceSeq).where(eq(hrmsGrievanceSeq.tenantId, t));
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, t));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, t));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, t));
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("register", () => {
  it("issues GRV/YYYY/NNNN per tenant, sequentially, with a history event and an audit event", async () => {
    const r1 = await register(grievant);
    expect(r1.statusCode).toBe(202);
    await drain();
    const r2 = await register(grievant, { subject: "Second case" });
    await drain();
    const id1 = (r1.json() as { id: string }).id;
    const id2 = (r2.json() as { id: string }).id;
    const rows = await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.tenantId, TENANT)));
    const byId = new Map(rows.map((x) => [x.id, x.caseNo]));
    expect(byId.get(id1)).toBe(`GRV/${YEAR}/0001`);
    expect(byId.get(id2)).toBe(`GRV/${YEAR}/0002`);
    expect(await audits(TENANT, id1)).toEqual(["register"]);
    const ev = await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievanceEvents).where(eq(hrmsGrievanceEvents.grievanceId, id1)));
    expect(ev.map((e) => e.action)).toEqual(["register"]);
  });

  it("numbers another tenant's register independently (its first case is 0001) and never leaks across tenants", async () => {
    const otherEmp = await seedEmployee(OTHER_TENANT, "Other Tenant Person");
    const r = await register(otherEmp, {}, headers(["hr_admin"], OTHER_TENANT));
    expect(r.statusCode).toBe(202);
    await drain();
    const id = (r.json() as { id: string }).id;
    const row = (await asTenant(OTHER_TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.id, id))))[0]!;
    expect(row.caseNo).toBe(`GRV/${YEAR}/0001`);
    // the first tenant cannot read it
    const cross = await app.inject({ method: "GET", url: `/v1/hrms/grievances/${id}`, headers: headers() });
    expect(cross.statusCode).toBe(404);
  });

  it("never reuses a number under concurrent registrations (10 parallel -> 10 distinct sequential numbers)", async () => {
    const before = (await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.tenantId, TENANT)))).length;
    await Promise.all(Array.from({ length: 10 }, (_, i) => register(grievant, { subject: `Parallel ${i}` })));
    await drain();
    const rows = await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.tenantId, TENANT)));
    expect(rows.length).toBe(before + 10);
    const nos = rows.map((x) => x.caseNo);
    expect(new Set(nos).size).toBe(nos.length);
    const seqs = nos.map((n) => Number(n.split("/")[2])).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });

  it("a double-submit with the same x-idempotency-key registers ONE grievance", async () => {
    const key = `idem-${randomUUID()}`;
    const a = await register(grievant, { subject: "Idem case" }, headers(["hr_officer"], TENANT, { "x-idempotency-key": key }));
    const b = await register(grievant, { subject: "Idem case" }, headers(["hr_officer"], TENANT, { "x-idempotency-key": key }));
    await drain();
    expect((a.json() as { id: string }).id).toBe((b.json() as { id: string }).id);
    const rows = await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(and(eq(hrmsGrievances.tenantId, TENANT), eq(hrmsGrievances.subject, "Idem case"))));
    expect(rows.length).toBe(1);
  });

  it("rejects a future filed date, an unknown employee, a bad category and a non-HR role", async () => {
    expect((await register(grievant, { filedDate: "2999-01-01" })).statusCode).toBe(422);
    expect((await register(randomUUID())).statusCode).toBe(404);
    expect((await register(grievant, { category: "made_up" })).statusCode).toBe(400);
    // POSH Act: there is no "harassment" category; those complaints go to the ICC
    expect((await register(grievant, { category: "harassment" })).statusCode).toBe(400);
    expect((await register(grievant, {}, headers(["employee"]))).statusCode).toBe(403);
    expect((await register(grievant, {}, headers(["manager"]))).statusCode).toBe(403);
  });
});

describe("list (coarse) and detail (audited read)", () => {
  it("returns coarse columns only (no description/subject), names, a total and reconciling counts; pages with a stable order", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/grievances?limit=5&offset=0", headers: headers() });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<Record<string, unknown>>; meta: { total: number; counts: { total: number; open: number; underInquiry: number; disposed: number } } };
    expect(body.data.length).toBe(5);
    for (const row of body.data) {
      expect(row).not.toHaveProperty("description");
      expect(row).not.toHaveProperty("subject");
      expect(row.employee).toBe("A. Kumar");
      expect(row.department).toBe("Revenue");
    }
    const c = body.meta.counts;
    expect(c.open + c.underInquiry + c.disposed).toBe(c.total);
    expect(body.meta.total).toBe(c.total);
    const p2 = (await app.inject({ method: "GET", url: "/v1/hrms/grievances?limit=5&offset=5", headers: headers() })).json() as typeof body;
    const ids1 = new Set(body.data.map((x) => x.id));
    expect(p2.data.every((x) => !ids1.has(x.id))).toBe(true);
  });

  it("bounds the page size", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/hrms/grievances?limit=1000", headers: headers() })).statusCode).toBe(400);
  });

  it("returns the description on the detail read and audits that read; non-HR is 403", async () => {
    const reg = await register(grievant, { subject: "Detail case", description: "Sensitive free text here" });
    await drain();
    const id = (reg.json() as { id: string }).id;
    const d = await app.inject({ method: "GET", url: `/v1/hrms/grievances/${id}`, headers: headers() });
    expect(d.statusCode).toBe(200);
    expect((d.json() as { data: { description: string } }).data.description).toBe("Sensitive free text here");
    await drain();
    expect(await audits(TENANT, id)).toEqual(["register", "read"]);
    expect((await app.inject({ method: "GET", url: `/v1/hrms/grievances/${id}`, headers: headers(["employee"]) })).statusCode).toBe(403);
  });
});

describe("assign and dispose", () => {
  it("assign moves registered -> under_inquiry, records officer + event + audit; re-assign is allowed; conflict of interest and unknown officer are refused", async () => {
    const id = ((await register(grievant, { subject: "Assign case" })).json() as { id: string }).id;
    await drain();
    expect((await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/assign`, headers: headers(), payload: { assigneeEmployeeId: grievant } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/assign`, headers: headers(), payload: { assigneeEmployeeId: randomUUID() } })).statusCode).toBe(404);
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/assign`, headers: headers(), payload: { assigneeEmployeeId: officer, note: "please inquire" } });
    expect(ok.statusCode).toBe(202);
    await drain();
    const row = (await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.id, id))))[0]!;
    expect(row.status).toBe("under_inquiry");
    expect(row.assignedTo).toBe(officer);
    expect(await audits(TENANT, id)).toEqual(["register", "assign"]);
    const detail = (await app.inject({ method: "GET", url: `/v1/hrms/grievances/${id}`, headers: headers() })).json() as { data: { assignedToName: string; events: Array<{ action: string; note: string | null }> } };
    expect(detail.data.assignedToName).toBe("R. Singh");
    expect(detail.data.events.map((e) => e.action)).toEqual(["register", "assign"]);
    expect(detail.data.events[1]!.note).toBe("please inquire");
  });

  it("dispose requires remarks, closes the case, blocks further assign/dispose, and audits", async () => {
    const id = ((await register(grievant, { subject: "Dispose case" })).json() as { id: string }).id;
    await drain();
    expect((await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/dispose`, headers: headers(), payload: { disposition: "resolved" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/dispose`, headers: headers(), payload: { disposition: "resolved", remarks: "x" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/dispose`, headers: headers(), payload: { disposition: "resolved", remarks: "Arrears were paid" } });
    expect(ok.statusCode).toBe(202);
    await drain();
    const row = (await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.id, id))))[0]!;
    expect(row).toMatchObject({ status: "disposed", disposition: "resolved", disposalRemarks: "Arrears were paid", disposedBy: ACTOR });
    expect(await audits(TENANT, id)).toEqual(["register", "dispose"]);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/dispose`, headers: headers(), payload: { disposition: "withdrawn", remarks: "again please" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/assign`, headers: headers(), payload: { assigneeEmployeeId: officer } })).statusCode).toBe(409);
  });

  it("two simultaneous disposes of one case: exactly one wins (one event, one audit) -- the conditional UPDATE is race-safe", async () => {
    const id = ((await register(grievant, { subject: "Race case" })).json() as { id: string }).id;
    await drain();
    // both pass the route's open-status pre-check, then race in the consumer
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/dispose`, headers: headers(), payload: { disposition: "resolved", remarks: "first remarks" } }),
      app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/dispose`, headers: headers(), payload: { disposition: "withdrawn", remarks: "second remarks" } }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    await drain();
    const events = await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievanceEvents).where(and(eq(hrmsGrievanceEvents.grievanceId, id), eq(hrmsGrievanceEvents.action, "dispose"))));
    expect(events.length).toBe(1);
    expect((await audits(TENANT, id)).filter((x) => x === "dispose").length).toBe(1);
  });

  it("repo.transitionTx: of two concurrent transactions only one flips an open case (DB-level race)", async () => {
    const id = ((await register(grievant, { subject: "Tx race" })).json() as { id: string }).id;
    await drain();
    const attempt = (who: string) => asTenant(TENANT, (tx) => repo.transitionTx(tx, TENANT, id, ACTOR, {
      from: ["registered", "under_inquiry"], to: "disposed",
      set: { disposition: "resolved", disposalRemarks: who, disposedAt: new Date(), disposedBy: ACTOR },
    }));
    const results = await Promise.all([attempt("a"), attempt("b"), attempt("c")]);
    expect(results.filter((r) => r !== null).length).toBe(1);
  });
});

describe("migration 0177 constraints", () => {
  it("a disposed row without disposition/remarks, an unknown status and a duplicate case number are all refused by the database", async () => {
    const mk = (over: Record<string, unknown>) => asTenant(TENANT, (tx) => tx.insert(hrmsGrievances).values({
      tenantId: TENANT, caseNo: `GRV/9999/${Math.floor(Math.random() * 9000 + 1000)}`, employeeId: grievant, category: "other",
      subject: "c", description: "constraint probe row", filedDate: "2026-01-01", createdBy: ACTOR, updatedBy: ACTOR, ...over,
    } as typeof hrmsGrievances.$inferInsert));
    await expect(mk({ status: "disposed" })).rejects.toThrow();
    await expect(mk({ status: "bogus" })).rejects.toThrow();
    await expect(mk({ category: "bogus" })).rejects.toThrow();
    await expect(mk({ category: "harassment" })).rejects.toThrow();
    const dup = "GRV/9998/0001";
    await mk({ caseNo: dup });
    await expect(mk({ caseNo: dup })).rejects.toThrow();
  });
});

describe("conflict of interest: the complainant cannot act on their own grievance (reviewer HIGH)", () => {
  const asComplainant = () => headers(["hr_officer"], TENANT, {}, COMPLAINANT_USER);

  it("detail, assign and dispose by the complainant are 403 CONFLICT_OF_INTEREST, and nothing changes", async () => {
    const id = ((await register(grievant, { subject: "Own case" })).json() as { id: string }).id;
    await drain();
    const code = (r: { json: () => unknown }) => (r.json() as { code: string }).code;
    const d = await app.inject({ method: "GET", url: `/v1/hrms/grievances/${id}`, headers: asComplainant() });
    expect(d.statusCode).toBe(403); expect(code(d)).toBe("CONFLICT_OF_INTEREST");
    const a = await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/assign`, headers: asComplainant(), payload: { assigneeEmployeeId: officer } });
    expect(a.statusCode).toBe(403); expect(code(a)).toBe("CONFLICT_OF_INTEREST");
    const x = await app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/dispose`, headers: asComplainant(), payload: { disposition: "resolved", remarks: "closing my own case" } });
    expect(x.statusCode).toBe(403); expect(code(x)).toBe("CONFLICT_OF_INTEREST");
    await drain();
    const row = (await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.id, id))))[0]!;
    expect(row.status).toBe("registered");
    // the same case is fine for a different HR actor
    expect((await app.inject({ method: "GET", url: `/v1/hrms/grievances/${id}`, headers: headers() })).statusCode).toBe(200);
  });

  it("the actor's own cases are filtered out of the list, rows and counts alike (counts still reconcile)", async () => {
    const mine = ((await register(grievant, { subject: "Mine A" })).json() as { id: string }).id;
    const others = ((await register(officer, { subject: "Officer's own complaint" })).json() as { id: string }).id;
    await drain();
    const list = async (hh: ReturnType<typeof headers>) =>
      (await app.inject({ method: "GET", url: "/v1/hrms/grievances?limit=100", headers: hh })).json() as { data: Array<{ id: string; employeeId: string }>; meta: { total: number; counts: { total: number; open: number; underInquiry: number; disposed: number } } };
    const asC = await list(asComplainant());
    expect(asC.data.some((r) => r.id === mine)).toBe(false);
    expect(asC.data.every((r) => r.employeeId !== grievant)).toBe(true);
    expect(asC.data.some((r) => r.id === others)).toBe(true);
    const neutral = await list(headers());
    expect(neutral.data.some((r) => r.id === mine)).toBe(true);
    expect(neutral.meta.total).toBeGreaterThan(asC.meta.total);
    for (const l of [asC, neutral]) {
      expect(l.meta.counts.open + l.meta.counts.underInquiry + l.meta.counts.disposed).toBe(l.meta.counts.total);
      expect(l.meta.counts.total).toBe(l.meta.total);
    }
  });

  it("consumer re-check: a command published with the complainant as actor is not applied (assign or dispose)", async () => {
    const id = ((await register(grievant, { subject: "Queue bypass" })).json() as { id: string }).id;
    await drain();
    const publish = (topic: string, payload: Record<string, unknown>) => queue.publish(topic, {
      messageId: randomUUID(), type: topic, tenantId: TENANT, actorId: COMPLAINANT_USER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, ...payload },
    });
    await publish("hrms.grievance.assign", { assigneeEmployeeId: officer, note: null }).catch(() => undefined);
    await publish("hrms.grievance.dispose", { disposition: "resolved", remarks: "self-disposal attempt" }).catch(() => undefined);
    await drain().catch(() => undefined);
    const row = (await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.id, id))))[0]!;
    expect(row.status).toBe("registered");
    expect(row.assignedTo).toBeNull();
    const ev = await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievanceEvents).where(eq(hrmsGrievanceEvents.grievanceId, id)));
    expect(ev.map((e) => e.action)).toEqual(["register"]);
  });
});

describe("assignee must hold an HR role (reviewer N4)", () => {
  it("assigning to an employee without an HR role is 422; to someone with one is accepted; an unverifiable role fails closed (503)", async () => {
    const id = ((await register(grievant, { subject: "Role check" })).json() as { id: string }).id;
    await drain();
    const assign = (to: string) => app.inject({ method: "POST", url: `/v1/hrms/grievances/${id}/assign`, headers: headers(), payload: { assigneeEmployeeId: to } });
    const noRole = await assign(plain);
    expect(noRole.statusCode).toBe(422);
    expect((noRole.json() as { code: string }).code).toBe("ASSIGNEE_NOT_HR_OFFICER");
    rolesByUser.set(PLAIN_USER, undefined); // identity lookup unavailable
    const down = await assign(plain);
    expect(down.statusCode).toBe(503);
    rolesByUser.set(PLAIN_USER, ["employee"]);
    // an employee with no linked user account cannot hold a role either
    const unlinked = await seedEmployee(TENANT, "No Account");
    expect((await assign(unlinked)).statusCode).toBe(422);
    expect((await assign(officer)).statusCode).toBe(202);
    await drain();
    const row = (await asTenant(TENANT, (tx) => tx.select().from(hrmsGrievances).where(eq(hrmsGrievances.id, id))))[0]!;
    expect(row.assignedTo).toBe(officer);
  });
});
