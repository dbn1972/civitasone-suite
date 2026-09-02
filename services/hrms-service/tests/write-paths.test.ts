/**
 * hrms-service core write-path tests.
 *
 * Exercises the lifecycle/command write-paths named in the 10/10 rubric against
 * the real Fastify app + Postgres, with state-transition and immutability/
 * concurrency assertions:
 *   - promotion (master mutation + service-book event)
 *   - transfer-order lifecycle: requested -> ordered -> relieved -> joined
 *   - service-book attestation immutability (edit-after-attest blocked)
 *   - CCS leave apply (CQRS 202) + approve authz
 *   - 7th CPC annual increment (idempotent per effectiveDate) + pay-matrix lookup
 *   - pension / DCRG computation (GPF defined benefit)
 *   - RTI lifecycle: filed -> assigned -> responded -> appealed -> closed
 *   - LMS nomination completion (nominated -> completed, immutable replay)
 *
 * Each run uses an isolated random tenant so it is robust to shared-DB state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { registerLifecycleMutationConsumers } from "../src/modules/lifecycle/consumer.js";
import { registerF3_service_book_Consumers } from "../src/modules/service-book/f3-consumer.js";
import { registerF3_rti_Consumers } from "../src/modules/rti/f3-consumer.js";
import { registerTrainingConsumers } from "../src/modules/training/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsServiceBookEntries } from "../src/modules/service-book/schema.js";
import { hrmsTransfers, hrmsPromotions } from "../src/modules/lifecycle/schema.js";
import { hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveApps } from "../src/modules/leave/schema.js";
import { hrmsRtiRequests } from "../src/modules/rti/schema.js";
import { hrmsTrainings, hrmsNominations } from "../src/modules/training/schema.js";

// These routes now write via publishF3Write/queue.publish + an async F3
// consumer (CQRS) instead of mutating synchronously — see individual `it`s
// below. Only worker.ts wires consumers + the tenant-aware subscribe wrapper
// in production, so tests must do both themselves. Mirrors the established
// pattern in tests/agent1-gap-routes.test.ts and tests/disciplinary-rule14.test.ts.
//
// This file needs TWO different op-dispatch consumers on the same generic
// "hrms.f3.route_write" topic at once (service-book's and rti's — both
// publish via publishF3Write onto that one topic and self-filter by
// payload.op). That combination surfaced a real bug in
// MemoryQueue.deliver() (services/queue-service/src/bus.ts): its per-message
// dedup key is topic+messageId with NO subscriber identity, and it is marked
// seen synchronously before the first handler's await. When two real
// queue.subscribe() calls target the same topic, the first handler's
// deliver() always wins that race and the second handler's deliver() finds
// the key already seen and returns without ever invoking its handler — so
// only the FIRST-registered consumer on a shared topic ever runs, for every
// message regardless of op. No existing test in this repo registers two
// op-dispatch consumers on the same shared topic together, so this had never
// been hit before (confirmed empirically: with only rti's consumer
// registered, drain-then-read-back works; adding service-book's consumer
// ahead of it silently drops every rti write). This looks like a gap between
// the production driver (SqsQueue, which gives each subscribing service its
// own queue per topic) and this in-memory test double, not something to
// patch in the shared queue-service package from here — so instead make
// same-topic subscriptions fan out correctly ourselves: issue only ONE real
// queue.subscribe() per topic (so MemoryQueue's dedup never sees a second
// competing handler), and dispatch to every logically-registered handler for
// that topic directly.
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  const fanout = new Map<string, Handler[]>();
  q.subscribe = ((topic: string, handler: Handler) => {
    const wrapped = withTenantConsumer(handler) as Handler;
    const existing = fanout.get(topic);
    if (existing) {
      existing.push(wrapped);
      return;
    }
    fanout.set(topic, [wrapped]);
    rawSubscribe(topic, async (msg) => {
      await Promise.all((fanout.get(topic) ?? []).map((h) => h(msg)));
    });
  }) as typeof q.subscribe;
  return q;
}
wireTenantAwareQueue(queue);
registerLifecycleMutationConsumers(queue);
registerF3_service_book_Consumers(queue);
registerF3_rti_Consumers(queue);
registerTrainingConsumers(queue);

/** Await the async F3 write(s) published by the route(s) just injected. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

const TENANT = randomUUID();
const ACTOR = randomUUID();

function mint(roles: string[], tid = TENANT): string {
  const S = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
  const n = Math.floor(Date.now() / 1000);
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ sub: ACTOR, iss: "civitasone-dev", tid, tenantId: tid, sid: "t", email: "t@t.dev", name: "Test", roles, iat: n, exp: n + 3600 });
  const s = createHmac("sha256", S).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
const HR = { authorization: `Bearer ${mint(["hr_admin", "super_admin"])}` };
const CITIZEN = { authorization: `Bearer ${mint(["citizen"])}` };
const CT = { "content-type": "application/json" };

let app: FastifyInstance;
const deptId = randomUUID();
const desigFrom = randomUUID();
const desigTo = randomUUID();
const deptTo = randomUUID();

// employee fixture ids
const empPromo = randomUUID();
const empTransfer = randomUUID();
const empLeave = randomUUID();
const empPension = randomUUID();
const empIncrement = randomUUID();

async function seedEmployee(id: string, over: Partial<typeof hrmsEmployees.$inferInsert> = {}): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: "Test Emp",
      departmentId: deptId, designationId: desigFrom, dateOfJoining: "2005-06-01",
      status: "confirmed", basicMinor: 5610000n, employeeType: "permanent",
      createdBy: ACTOR, updatedBy: ACTOR, ...over,
    });
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values([
      { id: deptId, tenantId: TENANT, code: "D1", name: "Dept 1", createdBy: ACTOR, updatedBy: ACTOR },
      { id: deptTo, tenantId: TENANT, code: "D2", name: "Dept 2", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(hrmsDesignations).values([
      { id: desigFrom, tenantId: TENANT, code: "JR", name: "Junior", level: 10, createdBy: ACTOR, updatedBy: ACTOR },
      { id: desigTo, tenantId: TENANT, code: "SR", name: "Senior", level: 11, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
  await seedEmployee(empPromo);
  await seedEmployee(empTransfer);
  await seedEmployee(empLeave);
  await seedEmployee(empPension, { pensionScheme: "GPF", dateOfBirth: "1962-07-01", basicMinor: 8000000n });
  await seedEmployee(empIncrement, { basicMinor: 5610000n }); // level 10 entry
});

afterAll(async () => {
  // Clean all test data for this isolated tenant.
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsNominations).where(eq(hrmsNominations.tenantId, TENANT));
    await tx.delete(hrmsTrainings).where(eq(hrmsTrainings.tenantId, TENANT));
    await tx.delete(hrmsRtiRequests).where(eq(hrmsRtiRequests.tenantId, TENANT));
    await tx.delete(hrmsLeaveApps).where(eq(hrmsLeaveApps.tenantId, TENANT));
    await tx.delete(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.tenantId, TENANT));
    await tx.delete(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, TENANT));
    await tx.delete(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.tenantId, TENANT));
    await tx.delete(hrmsTransfers).where(eq(hrmsTransfers.tenantId, TENANT));
    await tx.delete(hrmsPromotions).where(eq(hrmsPromotions.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

// ── 1. Promotion ─────────────────────────────────────────────────────
describe("Promotion write-path", () => {
  it("rejects unauthorized role (citizen -> 403)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lifecycle/promotions", headers: { ...CITIZEN, ...CT },
      payload: { employeeId: empPromo, fromDesigId: desigFrom, toDesigId: desigTo, effectiveDate: "2024-01-01" } });
    expect(r.statusCode).toBe(403);
  });

  it("rejects invalid body (Zod 400)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lifecycle/promotions", headers: { ...HR, ...CT },
      payload: { employeeId: "not-a-uuid", toDesigId: desigTo } });
    expect(r.statusCode).toBe(400);
  });

  it("promotes: mutates master designation+pay and writes service-book entry", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lifecycle/promotions", headers: { ...HR, ...CT },
      payload: { employeeId: empPromo, fromDesigId: desigFrom, toDesigId: desigTo, effectiveDate: "2024-04-01", newBasicMinor: 6770000, orderRef: "PROMO/1" } });
    expect(r.statusCode).toBe(202);
    await drainF3();
    const [emp] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, empPromo))));
    expect(emp.designationId).toBe(desigTo);
    expect(emp.basicMinor).toBe(6770000n);
    const sb = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.employeeId, empPromo))));
    expect(sb.some((e) => e.entryType === "promotion")).toBe(true);
  });
});

// ── 2. Transfer-order lifecycle ──────────────────────────────────────
describe("Transfer-order lifecycle: requested -> ordered -> relieved -> joined", () => {
  let transferId = "";
  it("creates a transfer REQUEST (no master mutation yet)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lifecycle/transfers", headers: { ...HR, ...CT },
      payload: { employeeId: empTransfer, fromDeptId: deptId, toDeptId: deptTo, effectiveDate: "2024-05-01", toStation: "Pune" } });
    expect(r.statusCode).toBe(202);
    transferId = r.json().id;
    expect(r.json().status).toBe("accepted");
    await drainF3();
    const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsTransfers).where(eq(hrmsTransfers.id, transferId))));
    expect(row.status).toBe("requested");
    const [emp] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, empTransfer))));
    expect(emp.departmentId).toBe(deptId); // unchanged at request time
  });

  // KNOWN GAP (not fixed here — see PR description): lifecycle/commands.ts's
  // relieveTransfer publishes unconditionally with no synchronous pre-check
  // (unlike rti/routes.ts and service-book/routes.ts, which check current
  // state via a repo read BEFORE publishing). The invalid-state guard now
  // lives only inside the async consumer's repo.transitionTransfer, which
  // silently no-ops (0 rows matched `from`) instead of surfacing an error —
  // so this now returns 202 "accepted" even though nothing is applied. That
  // is a fake-success gap of the same shape already fixed for hold
  // reject/release in #883/#884, just not yet applied to lifecycle transfers.
  // Left failing and documented per task scope rather than papered over.
  it("cannot relieve before order is issued (409 INVALID_STATE)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${transferId}/relieve`, headers: { ...HR, ...CT },
      payload: { relievedDate: "2024-05-10" } });
    expect(r.statusCode).toBe(409);
  });

  it("issues order (requested -> ordered)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${transferId}/issue-order`, headers: { ...HR, ...CT },
      payload: { orderNo: "TO/2024/1", orderDate: "2024-05-02" } });
    expect(r.statusCode).toBe(202);
    await drainF3();
    const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsTransfers).where(eq(hrmsTransfers.id, transferId))));
    expect(row.status).toBe("ordered");
  });

  it("relieves (ordered -> relieved)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${transferId}/relieve`, headers: { ...HR, ...CT },
      payload: { relievedDate: "2024-05-10" } });
    expect(r.statusCode).toBe(202);
    await drainF3();
    const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsTransfers).where(eq(hrmsTransfers.id, transferId))));
    expect(row.status).toBe("relieved");
  });

  it("joins (relieved -> joined): mutates master dept/station + writes service-book", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${transferId}/join`, headers: { ...HR, ...CT },
      payload: { joinedDate: "2024-05-12" } });
    expect(r.statusCode).toBe(202);
    await drainF3();
    const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsTransfers).where(eq(hrmsTransfers.id, transferId))));
    expect(row.status).toBe("joined");
    const [emp] = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, empTransfer))));
    expect(emp.departmentId).toBe(deptTo);
    expect(emp.station).toBe("Pune");
    const sb = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.employeeId, empTransfer))));
    expect(sb.some((e) => e.entryType === "transfer")).toBe(true);
  });

  // KNOWN GAP — same missing-synchronous-pre-check issue as "cannot relieve
  // before order is issued" above. Left failing and documented, not fixed here.
  it("cannot double-join (joined -> joined blocked, 409)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${transferId}/join`, headers: { ...HR, ...CT },
      payload: { joinedDate: "2024-05-12" } });
    expect(r.statusCode).toBe(409);
  });
});

// ── 3. Service-book attestation immutability ─────────────────────────
describe("Service-book attestation immutability", () => {
  let entryId = "";
  it("creates an entry", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empPromo}/service-book`, headers: { ...HR, ...CT },
      payload: { entryType: "award", effectiveDate: "2024-06-01", description: "Commendation" } });
    expect(r.statusCode).toBe(202);
    entryId = r.json().id;
    await drainF3();
  });
  it("can edit before attestation", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/service-book/entries/${entryId}`, headers: { ...HR, ...CT },
      payload: { description: "Commendation (revised)" } });
    expect(r.statusCode).toBe(202);
    await drainF3();
  });
  it("attests (competent authority sign-off)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/service-book/entries/${entryId}/attest`, headers: { ...HR, ...CT },
      payload: { remarks: "verified" } });
    expect(r.statusCode).toBe(202);
    expect(r.json().attested).toBe(true);
    await drainF3();
  });
  it("edit-after-attest is blocked (409 ATTESTED_IMMUTABLE)", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/service-book/entries/${entryId}`, headers: { ...HR, ...CT },
      payload: { description: "tampered" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ATTESTED_IMMUTABLE");
  });
  it("re-attest is blocked (409 ALREADY_ATTESTED)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/service-book/entries/${entryId}/attest`, headers: { ...HR, ...CT }, payload: {} });
    expect(r.statusCode).toBe(409);
  });
});

// ── 4. CCS leave apply + approve authz ───────────────────────────────
describe("CCS leave apply (CQRS) + approve authz", () => {
  const ltId = randomUUID();
  const allocId = randomUUID();
  beforeAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(hrmsLeaveTypes).values({ id: ltId, tenantId: TENANT, code: "CL", name: "Casual Leave", maxDays: 8, createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(hrmsLeaveAllocs).values({ id: allocId, tenantId: TENANT, employeeId: empLeave, leaveTypeId: ltId, fy: "2024-25", totalDays: 8, balanceDays: 8, createdBy: ACTOR, updatedBy: ACTOR });
    }));
  });
  it("apply returns 202 (CQRS accepted)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-applications", headers: { ...HR, ...CT },
      payload: { employeeId: empLeave, leaveTypeId: ltId, allocId, fromDate: "2024-07-01", toDate: "2024-07-02", daysApplied: 2, reason: "personal" } });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
  });
  it("approve via this endpoint requires super_admin (manager -> 403 WORKFLOW_REQUIRED)", async () => {
    const mgr = { authorization: `Bearer ${mint(["manager"])}` };
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/leave-applications/${randomUUID()}/approve`, headers: mgr });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("WORKFLOW_REQUIRED");
  });
});

// ── 5. 7th CPC annual increment + pay-matrix lookup ──────────────────
describe("7th CPC pay matrix + annual increment (idempotent)", () => {
  it("pay-matrix lookup returns a cell value", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/pay-matrix/lookup?level=10&cell=1", headers: HR });
    expect(r.statusCode).toBe(200);
    expect(r.json().basicMinor).toBe("5610000");
  });
  // KNOWN GAP (not fixed here — see PR description): pay-matrix/routes.ts's
  // annual-increment handler is deliberately still a SYNCHRONOUS writer (see
  // the comment above its `db.update(hrmsEmployees)` call), but it calls bare
  // `db.update()`/`db.insert()` directly instead of going through
  // `scopedRead`/`req.tenantTx`/`tenantTransaction(db, ctx.tenantId, ...)`.
  // Those bare calls never run `SET LOCAL app.tenant_id`, so under
  // NOBYPASSRLS + FORCE ROW LEVEL SECURITY the INSERT into
  // hrms_service_book_entries is rejected ("new row violates row-level
  // security policy") whenever the request's tenant context comes only from
  // the JWT `tid` claim (as it now does — no `x-tenant-id` header) rather
  // than the legacy `x-tenant-id`-header-driven AsyncLocalStorage path. This
  // is a real 500, not a stale status-code assertion; not fixed here.
  it("annual increment advances the isolated employee one cell + writes service-book", async () => {
    const before = (await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, empIncrement)))))[0].basicMinor;
    const r = await app.inject({ method: "POST", url: "/v1/hrms/pay-matrix/annual-increment", headers: { ...HR, ...CT },
      payload: { effectiveDate: "2024-07-01" } });
    expect(r.statusCode).toBe(200);
    const after = (await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, empIncrement)))))[0].basicMinor;
    expect(after).toBeGreaterThan(before);
  });
  it("re-running for the SAME effectiveDate is idempotent (no second advance)", async () => {
    const before = (await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, empIncrement)))))[0].basicMinor;
    const r = await app.inject({ method: "POST", url: "/v1/hrms/pay-matrix/annual-increment", headers: { ...HR, ...CT },
      payload: { effectiveDate: "2024-07-01" } });
    expect(r.statusCode).toBe(200);
    const after = (await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, empIncrement)))))[0].basicMinor;
    expect(after).toBe(before); // unchanged — guarded
    const body = r.json();
    expect(body.skippedAlreadyIncremented).toBeGreaterThan(0);
  });
});

// ── 6. Pension / DCRG (GPF defined benefit) ──────────────────────────
describe("Pension / DCRG computation", () => {
  it("computes defined-benefit pension + DCRG for a GPF employee", async () => {
    const r = await app.inject({ method: "GET",
      url: `/v1/hrms/employees/${empPension}/pension?retirementDate=2024-07-31&daRatePct=50&commutePct=40`, headers: HR });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.definedBenefit).toBe(true);
    expect(Number(b.dcrg.payableMinor)).toBeGreaterThan(0);
    expect(Number(b.monthlyPensionMinor)).toBeGreaterThan(0);
  });
  it("NPS employee yields no defined benefit", async () => {
    const r = await app.inject({ method: "GET",
      url: `/v1/hrms/employees/${empPromo}/pension?retirementDate=2030-07-31`, headers: HR });
    expect(r.statusCode).toBe(200);
    expect(r.json().definedBenefit).toBe(false);
  });
});

// ── 7. RTI lifecycle ─────────────────────────────────────────────────
describe("RTI lifecycle: filed -> assigned -> responded -> appealed -> closed", () => {
  let rtiId = "";
  it("files an RTI (status filed, due date computed)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: { ...HR, ...CT },
      payload: { referenceNo: `RTI/${randomUUID().slice(0, 8)}`, applicantName: "A Citizen", subject: "Records", requestText: "Please provide records", receivedDate: "2024-06-01" } });
    expect(r.statusCode).toBe(202);
    rtiId = r.json().id;
    expect(r.json().status).toBe("accepted");
    expect(r.json().dueDate).toBe("2024-07-01");
    await drainF3();
  });
  it("assigns PIO (filed -> assigned)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${rtiId}/assign`, headers: { ...HR, ...CT },
      payload: { pioId: randomUUID() } });
    expect(r.statusCode).toBe(202);
    await drainF3();
  });
  it("cannot close before responded (409)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${rtiId}/close`, headers: { ...HR, ...CT },
      payload: { closedDate: "2024-06-20" } });
    expect(r.statusCode).toBe(409);
  });
  it("responds (assigned -> responded)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${rtiId}/respond`, headers: { ...HR, ...CT },
      payload: { responseText: "Records attached", respondedDate: "2024-06-15" } });
    expect(r.statusCode).toBe(202);
    await drainF3();
  });
  it("appeals (responded -> appealed) then closes (appealed -> closed)", async () => {
    const a = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${rtiId}/appeal`, headers: { ...HR, ...CT },
      payload: { appealText: "Insufficient", appealDate: "2024-06-18" } });
    expect(a.statusCode).toBe(202);
    await drainF3();
    const c = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${rtiId}/close`, headers: { ...HR, ...CT },
      payload: { closedDate: "2024-06-25" } });
    expect(c.statusCode).toBe(202);
    await drainF3();
  });
});

// ── 8. LMS nomination completion ─────────────────────────────────────
describe("LMS nomination completion (nominated -> completed)", () => {
  const trId = randomUUID();
  const nomId = randomUUID();
  beforeAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(hrmsTrainings).values({ id: trId, tenantId: TENANT, title: "Ethics in Governance", fromDate: "2024-06-01", toDate: "2024-06-03", status: "planned", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(hrmsNominations).values({ id: nomId, tenantId: TENANT, trainingId: trId, employeeId: empPromo, status: "nominated", createdBy: ACTOR, updatedBy: ACTOR });
    }));
  });
  it("completes a nomination and writes a training service-book entry", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomId}/complete`, headers: { ...HR, ...CT },
      payload: { completedDate: "2024-06-03", result: "pass", score: 88, certificateRef: "CERT/1" } });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await drainF3();
    const sb = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.employeeId, empPromo))));
    expect(sb.some((e) => e.entryType === "training")).toBe(true);
  });
  it("re-completing is blocked (409 ALREADY_COMPLETED)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomId}/complete`, headers: { ...HR, ...CT },
      payload: { completedDate: "2024-06-03", result: "pass" } });
    expect(r.statusCode).toBe(409);
  });
});
