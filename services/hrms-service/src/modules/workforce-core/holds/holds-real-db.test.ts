/**
 * Hold registry consumption (SmartTransfer OS, ST-M01-10) — real Postgres.
 *
 * Spec §4, §11; PROPOSED D-ST-16 (consume the EXISTING
 * lifecycle.hrms_employee_holds table and its EXISTING hold types only).
 *
 * Proven on a real DB:
 *   1. APPLY REFUSAL: an ACTIVE blocking hold covering the effective date
 *      refuses applyPosting — NOTHING is written (no occupancy / ledger /
 *      service book) and the refusal is AUDITED with reason EMPLOYEE_ON_HOLD +
 *      the hold's params (a CommandRefusal recorded via audit; hrms has no
 *      command_results table on main — D-20 is the smarttransfer-service's).
 *   2. RELEASED hold does NOT refuse (status released) — posting proceeds.
 *   3. EXPIRED hold does NOT refuse (effective_to before the date) — proceeds.
 *   4. READ API: staff (requireRole) get the active-holds view with the
 *      `blocks` flag; a citizen is 403; a cross-tenant caller sees an empty
 *      view (RLS isolation), never another tenant's holds.
 *
 * The WORKFORCE_CORE_LEDGER_ENABLED flag is ON before any module that reads it
 * is imported, so the consumer registers, the apply path is live and the read
 * route is mounted. All async goes through the real command → consumer path +
 * MemoryQueue.drain() (never a fixed sleep — house rule 10).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

process.env.WORKFORCE_CORE_LEDGER_ENABLED = "true";
// Default blocking config (unset env) = every active hold blocks.

const { runWithTenant, withRawTenantGuc } = await import("@civitasone/db");
const { db, sqlClient } = await import("../../../shared/db.js");
const { queue } = await import("../../../shared/infra.js");
const { hrmsEmployees } = await import("../../employee/schema.js");
const { wcPost, wcPostOccupancy, wcPostingLedger } = await import("../schema.js");
const { hrmsServiceBookEntries } = await import("../../service-book/schema.js");
const outboxImport = await import("@civitasone/outbox");
const { outboxMessages } = outboxImport;
const { registerApplyPostingConsumer } = await import("../apply-posting/consumer.js");
const { COMMANDS } = await import("../../../topics.js");
const { buildApp } = await import("../../../app.js");

import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { idempotentId, signToken } from "@civitasone/auth";

registerApplyPostingConsumer(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const officeA = randomUUID();
const officeB = randomUUID();

let app: FastifyInstance;

async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

function withTenant<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  tenant: string = TENANT,
): Promise<T> {
  return runWithTenant(tenant, () => db.transaction(fn)) as Promise<T>;
}

function asTenant<T>(tenant: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, tenant, fn);
}

async function seedEmployee(tenant: string, officeId: string): Promise<string> {
  const id = randomUUID();
  await withTenant(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id,
      tenantId: tenant,
      employeeNo: `H-${id.slice(0, 8)}`,
      fullName: "Hold Subject",
      departmentId: officeId,
      designationId: randomUUID(),
      dateOfJoining: "2015-01-01",
      station: "Hubli",
      workStateCode: "KA",
      hraCityClass: "Y",
      status: "confirmed",
      employeeType: "permanent",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
  }, tenant);
  return id;
}

async function seedPost(officeId: string): Promise<string> {
  const id = randomUUID();
  await withTenant(async (tx) => {
    await tx.insert(wcPost).values({
      id,
      tenantId: TENANT,
      postNo: `P-${id.slice(0, 8)}`,
      officeId,
      designationId: randomUUID(),
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
  });
  return id;
}

/** Insert a hold into the EXISTING lifecycle.hrms_employee_holds table. */
async function seedHold(
  tenant: string,
  employeeId: string,
  opts: {
    holdType: string;
    status: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await asTenant(tenant, (tx) => tx`
    INSERT INTO lifecycle.hrms_employee_holds
      (id, tenant_id, employee_id, hold_type, reason, status, requested_by, effective_from, effective_to)
    VALUES
      (${id}, ${tenant}, ${employeeId}, ${opts.holdType}, ${"test hold"}, ${opts.status},
       ${ACTOR}, ${opts.effectiveFrom}, ${opts.effectiveTo ?? null})
  `);
  return id;
}

async function publishApply(order: {
  orderId: string;
  employeeId: string;
  postId: string;
  effectiveDate: string;
  orderNumber: string;
}): Promise<void> {
  await runWithTenant(TENANT, () =>
    queue.publish(COMMANDS.postingApply, {
      messageId: idempotentId({
        idempotencyKey: `posting.apply:${order.orderId}`,
        tenantId: TENANT,
      }),
      type: COMMANDS.postingApply,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        orderId: order.orderId,
        tenantId: TENANT,
        employeeId: order.employeeId,
        postId: order.postId,
        effectiveDate: order.effectiveDate,
        chargeType: "substantive",
        orderNumber: order.orderNumber,
        // ST-M01-15 producer ACL: only the frozen contract owner may publish
        // hrms.posting.apply, so stamp it like apply-posting-real-db does.
        producer: "smarttransfer-service",
      },
    }),
  );
  await drain();
}

async function readOccupancy(employeeId: string) {
  return withTenant((tx) =>
    tx.select().from(wcPostOccupancy).where(eq(wcPostOccupancy.employeeId, employeeId)),
  );
}
async function readLedger(employeeId: string) {
  return withTenant((tx) =>
    tx.select().from(wcPostingLedger).where(eq(wcPostingLedger.employeeId, employeeId)),
  );
}
async function readServiceBook(employeeId: string) {
  return withTenant((tx) =>
    tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.employeeId, employeeId)),
  );
}
async function readAudits() {
  const rows = await withTenant((tx) =>
    tx
      .select({ payload: outboxMessages.payload })
      .from(outboxMessages)
      .where(eq(outboxMessages.topic, "audit.event.record")),
  );
  return rows as Array<{ payload: Record<string, unknown> }>;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const tenant of [TENANT, OTHER_TENANT]) {
    await asTenant(tenant, (tx) => tx`DELETE FROM lifecycle.hrms_employee_holds WHERE tenant_id = ${tenant}`);
    await asTenant(tenant, (tx) => tx`DELETE FROM lifecycle.hrms_service_book_entries WHERE tenant_id = ${tenant}`);
    await asTenant(tenant, (tx) => tx`DELETE FROM workforce_core.post_occupancy WHERE tenant_id = ${tenant}`);
    await asTenant(tenant, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tenant}`);
  }
});

describe("hold registry — an active blocking hold refuses applyPosting", () => {
  it("writes NOTHING and audits an EMPLOYEE_ON_HOLD refusal with params", async () => {
    const employeeId = await seedEmployee(TENANT, officeA);
    const postId = await seedPost(officeB);
    const holdId = await seedHold(TENANT, employeeId, {
      holdType: "transfer",
      status: "active",
      effectiveFrom: "2026-01-01",
      effectiveTo: null, // open-ended active hold
    });
    const orderId = randomUUID();

    await publishApply({
      orderId,
      employeeId,
      postId,
      effectiveDate: "2026-05-01",
      orderNumber: "ORD/HOLD/0001",
    });

    // No partial write.
    expect(await readOccupancy(employeeId)).toHaveLength(0);
    expect(await readLedger(employeeId)).toHaveLength(0);
    expect(await readServiceBook(employeeId)).toHaveLength(0);

    // Audited refusal with the hold params.
    const audits = await readAudits();
    const refusal = audits.find(
      (a) =>
        (a.payload as { resourceId?: string }).resourceId === orderId &&
        (a.payload as { outcome?: string }).outcome === "failure",
    );
    expect(refusal, "an audited refusal was recorded").toBeDefined();
    const meta = (refusal!.payload as { metadata?: Record<string, unknown> }).metadata!;
    expect(meta.reason).toBe("EMPLOYEE_ON_HOLD");
    const params = meta.params as Record<string, unknown>;
    expect(params.holdId).toBe(holdId);
    expect(params.holdType).toBe("transfer");
    expect(params.holdStatus).toBe("active");
  });
});

describe("hold registry — a released hold does NOT refuse", () => {
  it("the posting proceeds and writes occupancy + ledger", async () => {
    const employeeId = await seedEmployee(TENANT, officeA);
    const postId = await seedPost(officeB);
    await seedHold(TENANT, employeeId, {
      holdType: "transfer",
      status: "released", // no longer active
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    const orderId = randomUUID();

    await publishApply({
      orderId,
      employeeId,
      postId,
      effectiveDate: "2026-05-01",
      orderNumber: "ORD/HOLD/0002",
    });

    expect(await readOccupancy(employeeId)).toHaveLength(1);
    expect(await readLedger(employeeId)).toHaveLength(1);
  });
});

describe("hold registry — an expired hold does NOT refuse", () => {
  it("a hold whose window ended before the effective date is ignored", async () => {
    const employeeId = await seedEmployee(TENANT, officeA);
    const postId = await seedPost(officeB);
    await seedHold(TENANT, employeeId, {
      holdType: "all",
      status: "active",
      effectiveFrom: "2024-01-01",
      effectiveTo: "2024-12-31", // ended well before the posting
    });
    const orderId = randomUUID();

    await publishApply({
      orderId,
      employeeId,
      postId,
      effectiveDate: "2026-05-01",
      orderNumber: "ORD/HOLD/0003",
    });

    expect(await readOccupancy(employeeId)).toHaveLength(1);
    expect(await readLedger(employeeId)).toHaveLength(1);
  });
});

describe("hold registry — read API (eligibility) requireRole + RLS", () => {
  it("staff get the active-holds view with the blocks flag", async () => {
    const employeeId = await seedEmployee(TENANT, officeA);
    await seedHold(TENANT, employeeId, {
      holdType: "transfer",
      status: "active",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/hrms/workforce-core/employees/${employeeId}/holds?asOf=2026-05-01`,
      headers: {
        authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s-holds" }, SECRET)}`,
        "x-tenant-id": TENANT,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { hasBlockingHold: boolean; holds: Array<{ holdType: string; blocks: boolean }> } };
    expect(body.data.hasBlockingHold).toBe(true);
    expect(body.data.holds).toHaveLength(1);
    expect(body.data.holds[0]!.holdType).toBe("transfer");
    expect(body.data.holds[0]!.blocks).toBe(true);
  });

  it("a citizen is forbidden (staff-only requireRole)", async () => {
    const employeeId = await seedEmployee(TENANT, officeA);
    const res = await app.inject({
      method: "GET",
      url: `/v1/hrms/workforce-core/employees/${employeeId}/holds`,
      headers: {
        authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles: ["citizen"], sid: "s-cit" }, SECRET)}`,
        "x-tenant-id": TENANT,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a cross-tenant caller sees an empty view (RLS isolation)", async () => {
    // A hold exists for an employee in TENANT; a caller authenticated for
    // OTHER_TENANT must not see it even with the same employee id.
    const employeeId = await seedEmployee(TENANT, officeA);
    await seedHold(TENANT, employeeId, {
      holdType: "transfer",
      status: "active",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/hrms/workforce-core/employees/${employeeId}/holds?asOf=2026-05-01`,
      headers: {
        authorization: `Bearer ${signToken({ sub: ACTOR, tid: OTHER_TENANT, roles: ["hr_admin"], sid: "s-xt" }, SECRET)}`,
        "x-tenant-id": OTHER_TENANT,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { hasBlockingHold: boolean; holds: unknown[] } };
    expect(body.data.hasBlockingHold).toBe(false);
    expect(body.data.holds).toHaveLength(0);
  });
});
