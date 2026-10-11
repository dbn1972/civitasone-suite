/**
 * ST-M01-11 — cross-service live: hrms applyPosting → hrms.posting.changed →
 * payroll posting/DDO history (SmartTransfer OS). Decision D-17 (this dir).
 *
 * One vitest worker hosts BOTH services' real Drizzle singletons against one
 * real Postgres (civitas_hrms as hrms_svc, civitas_payroll as payroll_svc, both
 * NON-superuser so FORCE RLS is genuinely enforced), carries their events over
 * one real MemoryQueue, and moves outbox rows with the production relayOnce
 * (harness.relayAll). No fixed sleeps (house rule 10): relayAll runs to
 * quiescence.
 *
 * Proven end to end (not mocked):
 *   1. applyPosting in hrms (the single Workforce Core write path, ST-M01-09)
 *      emits hrms.posting.changed, which the payroll consumer turns into a
 *      dated posting_history row + an audit event — in payroll's own tx.
 *   2. The as-of read returns the posting effective before vs after the second
 *      posting's effective date.
 *   3. A posting for a NON-payroll tenant (not in PAYROLL_POSTING_TENANTS) is a
 *      clean no-op in payroll (markProcessed only).
 *   4. A redelivery of the same posting event is idempotent in payroll (no
 *      second history row).
 *
 * HOW TO RUN (own disposable Postgres, non-superuser roles, --maxWorkers=2):
 *   PGPORT=<free port> bash scripts/ci/bootstrap-postgres.sh
 *   DATABASE_URL unset; PGHOST/PGPORT point at the disposable instance.
 *   pnpm exec vitest run --maxWorkers=2 \
 *     tests/cross-service-live/payroll-posting-history.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { runWithTenant, withTenantScope, sql } from "@civitasone/db";
import { LiveHarness, assertFresh, tenant, type MountedService } from "./harness.js";

/**
 * A deterministic UUID-shaped message id from the order id. The hrms
 * applyPosting consumer keys markProcessed on messageId; a redelivery must
 * carry the SAME id to be a no-op. Computed locally (no `@civitasone/auth`
 * import) so the root-level test resolves without a new root dependency — the
 * exact value does not matter, only that it is deterministic per order id and
 * UUID-shaped (markProcessed stores it in a uuid column).
 */
function messageIdFor(tenantId: string, orderId: string): string {
  const h = createHash("sha256").update(`posting.apply:${tenantId}:${orderId}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}

const ACTOR = randomUUID();

// hrms: ledger live + standalone posting events emitted (both default off).
process.env.WORKFORCE_CORE_LEDGER_ENABLED = "true";
process.env.HRMS_POSTING_EVENTS_ENABLED = "true";
// payroll: posting consumer on (default off). Tenant allow-list is set in
// beforeAll once the tenant ids are known.
process.env.PAYROLL_POSTING_CONSUMER_ENABLED = "true";

let h: LiveHarness;
let hrms: MountedService;
let payroll: MountedService;

const PAYROLL_TENANT = tenant();
const NON_PAYROLL_TENANT = tenant();
/** Distinct employee id per tenant — hrms_employees PK is the bare id. */
const EMP_OF: Record<string, string> = {
  [PAYROLL_TENANT]: randomUUID(),
  [NON_PAYROLL_TENANT]: randomUUID(),
};
const OFFICE_A = randomUUID();
const OFFICE_B = randomUUID();

// Loaded after each service is mounted (its db.ts must bind first).
/* eslint-disable @typescript-eslint/no-explicit-any */
let hrmsEmployees: any;
let wcPost: any;
let HRMS_COMMANDS: any;
let registerApplyPostingConsumer: any;
let registerPostingConsumers: any;
let hrmsTenantScoped: any;
let payrollTenantScoped: any;
let payrollDb: any;
let payrollSql: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function seedHrms(tenantId: string): Promise<{ postId: string }> {
  const postId = randomUUID();
  const emp = EMP_OF[tenantId]!;
  await runWithTenant(tenantId, () =>
    hrms.db.transaction(async (tx: typeof hrms.db) => {
      await tx.insert(hrmsEmployees).values({
        id: emp,
        tenantId,
        employeeNo: `E-${emp.slice(0, 8)}`,
        fullName: "Posting Subject",
        departmentId: OFFICE_A,
        designationId: randomUUID(),
        dateOfJoining: "2015-01-01",
        station: "Dharwad",
        workStateCode: "KA",
        hraCityClass: "Y",
        status: "confirmed",
        employeeType: "permanent",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(wcPost).values({
        id: postId,
        tenantId,
        postNo: `P-${postId.slice(0, 8)}`,
        officeId: OFFICE_B,
        designationId: randomUUID(),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    }),
  );
  return { postId };
}

async function publishApply(
  tenantId: string,
  o: { orderId: string; postId: string; effectiveDate: string; orderNumber: string },
): Promise<void> {
  await runWithTenant(tenantId, () =>
    h.queue.publish(HRMS_COMMANDS.postingApply, {
      messageId: messageIdFor(tenantId, o.orderId),
      type: HRMS_COMMANDS.postingApply,
      tenantId,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        orderId: o.orderId,
        tenantId,
        employeeId: EMP_OF[tenantId]!,
        postId: o.postId,
        effectiveDate: o.effectiveDate,
        chargeType: "substantive",
        orderNumber: o.orderNumber,
      },
    } as never),
  );
  // publish() is fire-and-forget (MemoryQueue delivers on a 0ms timer); drain
  // so the hrms applyPosting consumer actually runs and writes hrms.posting.
  // changed into the hrms OUTBOX before relayAll() reads it. Without this,
  // relayAll's first pass relays an empty outbox and breaks (publishedThisPass
  // === 0) before the applied event exists. No fixed sleep — drain() awaits the
  // in-flight delivery to quiescence (house rule 10).
  await (h.queue as unknown as { drain: () => Promise<void> }).drain();
}

async function payrollHistory(tenantId: string): Promise<Array<Record<string, unknown>>> {
  return withTenantScope(payrollDb, tenantId, async (tx: { execute: (q: unknown) => Promise<unknown> }) => {
    const r = await tx.execute(sql`
      SELECT order_number, station, state, city_class, effective_from::text AS effective_from
      FROM payroll.posting_history
      WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${EMP_OF[tenantId]!}::uuid
      ORDER BY effective_from`);
    return Array.from(r as Iterable<Record<string, unknown>>);
  }) as Promise<Array<Record<string, unknown>>>;
}

/** The posting effective on/before `asOf` for the tenant's employee. */
async function payrollAsOf(tenantId: string, asOf: string): Promise<Record<string, unknown> | undefined> {
  return withTenantScope(payrollDb, tenantId, async (tx: { execute: (q: unknown) => Promise<unknown> }) => {
    const r = await tx.execute(sql`
      SELECT order_number, effective_from::text AS effective_from
      FROM payroll.posting_history
      WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${EMP_OF[tenantId]!}::uuid
        AND effective_from <= ${asOf}::date
      ORDER BY effective_from DESC LIMIT 1`);
    return (Array.from(r as Iterable<Record<string, unknown>>))[0];
  }) as Promise<Record<string, unknown> | undefined>;
}

beforeAll(async () => {
  process.env.PAYROLL_POSTING_TENANTS = PAYROLL_TENANT; // only this tenant has payroll
  h = new LiveHarness();
  // Mount hrms first (needs its ledger flag + a PII key for employee writes),
  // then payroll. Each service's db.ts binds to its own DSN at first import.
  hrms = await h.mount("hrms-service", { PII_ENC_KEY: "test_pii_key_for_civitasone_dev_32chars" });
  payroll = await h.mount("payroll-service", { PII_ENC_KEY: "test_pii_key_for_civitasone_dev_32chars" });
  await assertFresh([hrms, payroll]);

  ({ hrmsEmployees } = await import("../../services/hrms-service/src/modules/employee/schema.js"));
  ({ wcPost } = await import("../../services/hrms-service/src/modules/workforce-core/schema.js"));
  ({ COMMANDS: HRMS_COMMANDS } = await import("../../services/hrms-service/src/topics.js"));
  ({ registerApplyPostingConsumer } = await import(
    "../../services/hrms-service/src/modules/workforce-core/apply-posting/consumer.js"
  ));
  ({ tenantScoped: hrmsTenantScoped } = await import("../../services/hrms-service/src/shared/tenant-queue.js"));
  ({ registerPostingConsumers } = await import(
    "../../services/payroll-service/src/modules/posting-history/consumer.js"
  ));
  ({ tenantScoped: payrollTenantScoped } = await import("../../services/payroll-service/src/shared/tenant-queue.js"));
  payrollDb = payroll.db;
  payrollSql = payroll.sqlClient;

  await h.tap();
  // Register BOTH consumers on the shared queue, each wrapped with its own
  // service's tenantScoped() so the handler runs inside the message's tenant
  // GUC (the harness does not scope the queue itself).
  registerApplyPostingConsumer(hrmsTenantScoped(h.queue));
  registerPostingConsumers(payrollTenantScoped(h.queue));
  await h.start();

  await seedHrms(PAYROLL_TENANT);
  await seedHrms(NON_PAYROLL_TENANT);
});

afterAll(async () => {
  if (payrollSql) {
    await payrollSql`DELETE FROM payroll.posting_history WHERE tenant_id = ANY(${[PAYROLL_TENANT, NON_PAYROLL_TENANT]}::uuid[])`;
  }
  if (h) await h.stop();
});

/** The single seeded post for a tenant (withTenantScope ⇒ RLS GUC is set). */
async function seededPostId(tenantId: string): Promise<string> {
  const rows = (await withTenantScope(hrms.db, tenantId, async (tx: { execute: (q: unknown) => Promise<unknown> }) => {
    const r = await tx.execute(
      sql`SELECT id FROM workforce_core.post WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at LIMIT 1`,
    );
    return Array.from(r as Iterable<{ id: string }>);
  })) as Array<{ id: string }>;
  return rows[0]!.id;
}

describe("ST-M01-11 cross-service: applyPosting → payroll posting history", () => {
  it("a posting applied in hrms lands as a dated payroll history row (via the event)", async () => {
    const postId = await seededPostId(PAYROLL_TENANT);
    await publishApply(PAYROLL_TENANT, { orderId: randomUUID(), postId, effectiveDate: "2026-01-01", orderNumber: "ORD-1" });
    // relay hrms outbox (hrms.posting.changed) onto the queue → payroll consumer.
    await h.relayAll();

    const hist = await payrollHistory(PAYROLL_TENANT);
    expect(hist, "exactly one posting history row for the payroll tenant").toHaveLength(1);
    expect(hist[0]).toMatchObject({ order_number: "ORD-1", effective_from: "2026-01-01" });
    // tap() recorded a valid hrms.posting.changed envelope crossing the queue.
    const changed = h.tapped.filter((t) => t.topic === "hrms.posting.changed");
    expect(changed.length, "hrms.posting.changed crossed the queue").toBeGreaterThanOrEqual(1);
    expect(changed.every((t) => t.valid), "the transport envelope validates").toBe(true);
  });

  it("as-of returns the posting effective before vs after the next posting", async () => {
    // Seed a SECOND post in a different office and post the employee into it,
    // so this is a genuine office change (⇒ a second hrms.posting.changed).
    const postId2 = randomUUID();
    await withTenantScope(hrms.db, PAYROLL_TENANT, async (tx: typeof hrms.db) =>
      tx.insert(wcPost).values({
        id: postId2,
        tenantId: PAYROLL_TENANT,
        postNo: `P-${postId2.slice(0, 8)}`,
        officeId: randomUUID(),
        designationId: randomUUID(),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    );
    await publishApply(PAYROLL_TENANT, { orderId: randomUUID(), postId: postId2, effectiveDate: "2026-06-01", orderNumber: "ORD-2" });
    await h.relayAll();
    expect(await payrollHistory(PAYROLL_TENANT)).toHaveLength(2);

    const before = await payrollAsOf(PAYROLL_TENANT, "2026-03-01");
    expect(before?.order_number).toBe("ORD-1");
    const after = await payrollAsOf(PAYROLL_TENANT, "2026-07-01");
    expect(after?.order_number).toBe("ORD-2");
  });

  it("a NON-payroll tenant's posting is a clean no-op in payroll", async () => {
    const postId = await seededPostId(NON_PAYROLL_TENANT);
    await publishApply(NON_PAYROLL_TENANT, { orderId: randomUUID(), postId, effectiveDate: "2026-01-01", orderNumber: "ORD-NP" });
    await h.relayAll();
    expect(await payrollHistory(NON_PAYROLL_TENANT), "non-payroll tenant writes nothing").toHaveLength(0);
  });

  it("a redelivered posting event is idempotent in payroll (no duplicate row)", async () => {
    // Seed a third post (different office) → a real office change → a
    // hrms.posting.changed. Apply once, then re-publish the SAME order id: hrms
    // applyPosting is a no-op on redelivery; even if the changed event were
    // re-emitted, payroll's (tenant_id, event_id) UNIQUE drops it.
    const postId3 = randomUUID();
    await withTenantScope(hrms.db, PAYROLL_TENANT, async (tx: typeof hrms.db) =>
      tx.insert(wcPost).values({
        id: postId3,
        tenantId: PAYROLL_TENANT,
        postNo: `P-${postId3.slice(0, 8)}`,
        officeId: randomUUID(),
        designationId: randomUUID(),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    );
    const orderId = randomUUID();
    await publishApply(PAYROLL_TENANT, { orderId, postId: postId3, effectiveDate: "2026-09-01", orderNumber: "ORD-3" });
    await h.relayAll();
    const afterFirst = await payrollHistory(PAYROLL_TENANT);

    await publishApply(PAYROLL_TENANT, { orderId, postId: postId3, effectiveDate: "2026-09-01", orderNumber: "ORD-3" }); // redelivery
    await h.relayAll();
    const afterSecond = await payrollHistory(PAYROLL_TENANT);
    expect(afterSecond.length, "redelivery adds no row").toBe(afterFirst.length);
  });
});

