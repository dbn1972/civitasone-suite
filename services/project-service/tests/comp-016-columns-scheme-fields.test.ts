/**
 * project-service — scheme "detail fields" regression test (COMP-016 follow-up).
 *
 * Migration 0021 added 5 nullable columns to scheme.project_schemes:
 * nodal_officer, department, beneficiaries, start_date, end_date. PR #1240
 * (COMP-016) built a real getSchemeDetail() DTO but left all five
 * deliberately absent — no backing column existed anywhere in this schema.
 * The product/schema decision is now: add the columns. This suite proves,
 * end to end against a real Postgres (no mocks, real RLS, real F3 outbox
 * create path — nothing here is asserted against a mock):
 *
 *  1. a scheme created via the real COMMANDS.schemeCreate -> consumer write
 *     path (same registerSchemeConsumers() the real app wires in
 *     production, published the same way tests/project.test.ts's own CQRS
 *     test already does -- see createSchemeViaQueue()'s comment for why
 *     this goes around app.inject("POST", ...) rather than through it),
 *     with all 5 fields set, round-trips them correctly through the real
 *     GET /v1/projects/schemes/:id HTTP route.
 *  2. a scheme created without them returns them cleanly ABSENT from the
 *     JSON body (undefined, matching sanctionRef's existing convention) —
 *     never null, never a fabricated value, never a crash.
 *  3. beneficiaries=0 is a real, meaningful recorded value and must
 *     round-trip as 0, not be dropped as if it were "absent" by a careless
 *     truthy check (`row.beneficiaries ? ... : ...` instead of `!= null`).
 *  4. migration 0021's own CHECK constraints are real and enforced at the
 *     DB layer, independent of any application-level validation: a negative
 *     beneficiaries value, and an end_date before start_date, are both
 *     rejected — and a date pair with only one side set is NOT rejected
 *     (the constraint is a no-op until both sides are present).
 *
 * Sabotage-checked: reverting queries.ts's getSchemeDetail() back to the
 * pre-0021 version (deleting its 5 trailing `...(row.x != null ? {...} :
 * {})` spreads) reproduces the predicted symptom — cases 1 and 3 below fail
 * (nodalOfficer/department/beneficiaries/startDate/endDate all come back
 * `undefined` instead of the real values, including beneficiaries=0, which
 * would have been the ONE case a naive truthy-check fix could still get
 * wrong even after adding the fields back) — while case 2 keeps passing
 * either way, confirming it alone would NOT have caught this regression.
 * Restored afterwards; all 6 cases pass. Migration 0021 itself was
 * sabotage-checked separately by dropping its two CHECK constraints and
 * re-running cases 4-6 below: both negative-beneficiaries and
 * end-before-start inserts that should be rejected instead succeeded,
 * confirming those two assertions actually exercise the constraints rather
 * than passing vacuously.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { withTenantConsumer, runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { projectSchemes } from "../src/modules/scheme/schema.js";
import { registerSchemeConsumers } from "../src/modules/scheme/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "c016c000-dead-4000-8000-0000000c016c";
const ACTOR  = "c016c000-dead-4000-8000-0000000ac70c";

function authHeader(roles: string[] = ["project_manager"]) {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-comp-016-columns" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

// RLS fix: MemoryQueue instantiated directly (bypassing createQueue()) never
// gets the withTenantConsumer decoration createQueue() applies to every
// subscribe() call, so consumer handlers run with no app.tenant_id GUC set
// -- under FORCE RLS the write would be silently rejected. Same helper as
// tests/project.test.ts's tenantScopedQueue().
function tenantScopedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  (q as unknown as { subscribe: unknown }).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, withTenantConsumer(handler) as typeof handler);
  return q;
}

// Deliberately does NOT go through app.inject("POST", ...): the app's own
// internal queue (wired inside buildApp(), consumed by the separate
// worker.ts process in production) is a DIFFERENT MemoryQueue instance from
// any queue this test creates itself -- publishing on one never reaches
// subscribers on the other. tests/project.test.ts's own CQRS test hits this
// same fact and works around it the same way: publish the command directly
// to a locally-wired, tenant-scoped queue with the consumer attached, and
// reserve app.inject() for the read side (a real HTTP round trip through
// the real route + real getSchemeDetail(), no queue involved for GETs).
async function createSchemeViaQueue(payload: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const q = tenantScopedQueue();
  registerSchemeConsumers(q);
  await q.start();

  await q.publish(COMMANDS.schemeCreate, {
    messageId: randomUUID(), type: COMMANDS.schemeCreate,
    tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${id}`, schemaVersion: "1.0",
    payload: { id, tenantId: TENANT, ...payload },
  });

  // F3 outbox pattern: the create command is queued, not written inline.
  // Same fixed delay this suite's own tests/project.test.ts CQRS test
  // already relies on to let the consumer actually land the write.
  await new Promise<void>((r) => setTimeout(r, 600));
  await q.stop();
  return id;
}

let app: FastifyInstance;

async function clean() {
  // Wrapped in runWithTenant + db.transaction() so wrapWithTenantGuc injects
  // app.tenant_id before this write — a bare db.delete() runs with no RLS
  // GUC set and is silently rejected under FORCE RLS.
  await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.delete(projectSchemes).where(eq(projectSchemes.tenantId, TENANT))));
}

beforeAll(async () => {
  app = await buildApp();
  await clean();
});

afterAll(async () => {
  await clean();
  await app.close();
});

describe("scheme detail fields (COMP-016 follow-up, migration 0021)", () => {
  it("a scheme created with all 5 fields set round-trips them through the real GET route", async () => {
    const id = await createSchemeViaQueue({
      code: "COMP016COLS-A", name: "COMP-016 Columns Test Scheme A",
      totalOutlayMinor: 100000000,
      nodalOfficer: "Shri Test Officer",
      department: "Test Department of Testing",
      beneficiaries: 4200,
      startDate: "2024-04-01",
      endDate: "2026-03-31",
    });

    const getRes = await app.inject({ method: "GET", url: `/v1/projects/schemes/${id}`, headers: authHeader() });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.nodalOfficer).toBe("Shri Test Officer");
    expect(body.department).toBe("Test Department of Testing");
    expect(body.beneficiaries).toBe(4200);
    expect(body.startDate).toBe("2024-04-01");
    expect(body.endDate).toBe("2026-03-31");
  });

  it("a scheme created without them returns them cleanly absent -- undefined, never a crash", async () => {
    const id = await createSchemeViaQueue({
      code: "COMP016COLS-B", name: "COMP-016 Columns Test Scheme B", totalOutlayMinor: 0,
    });

    const getRes = await app.inject({ method: "GET", url: `/v1/projects/schemes/${id}`, headers: authHeader() });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.nodalOfficer).toBeUndefined();
    expect(body.department).toBeUndefined();
    expect(body.beneficiaries).toBeUndefined();
    expect(body.startDate).toBeUndefined();
    expect(body.endDate).toBeUndefined();
    // The rest of the DTO must still be intact -- this is a clean-absence
    // case, not a broken-response case.
    expect(body.name).toBe("COMP-016 Columns Test Scheme B");
  });

  it("beneficiaries=0 is a real value and must not be dropped as if absent", async () => {
    const id = await createSchemeViaQueue({
      code: "COMP016COLS-C", name: "COMP-016 Columns Test Scheme C", totalOutlayMinor: 0, beneficiaries: 0,
    });

    const getRes = await app.inject({ method: "GET", url: `/v1/projects/schemes/${id}`, headers: authHeader() });
    const body = getRes.json();
    expect(body.beneficiaries).toBe(0);
  });

  it("rejects a negative beneficiaries value at the DB layer (migration 0021's CHECK constraint)", async () => {
    await expect(runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.insert(projectSchemes).values({
        id: randomUUID(), tenantId: TENANT, code: "COMP016COLS-NEG", name: "Negative beneficiaries",
        beneficiaries: -1, createdBy: ACTOR, updatedBy: ACTOR,
      })
    ))).rejects.toThrow(/project_schemes_beneficiaries_check|violates check constraint/i);
  });

  it("rejects end_date before start_date at the DB layer (migration 0021's dates CHECK constraint)", async () => {
    await expect(runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.insert(projectSchemes).values({
        id: randomUUID(), tenantId: TENANT, code: "COMP016COLS-DATES", name: "End before start",
        startDate: "2026-03-31", endDate: "2024-04-01", createdBy: ACTOR, updatedBy: ACTOR,
      })
    ))).rejects.toThrow(/project_schemes_dates_chk|violates check constraint/i);
  });

  it("allows a date pair with only one side set -- the dates check is a no-op unless both are present", async () => {
    const idStartOnly = randomUUID();
    const idEndOnly = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(projectSchemes).values({
        id: idStartOnly, tenantId: TENANT, code: "COMP016COLS-SONLY", name: "Start only",
        startDate: "2026-01-01", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(projectSchemes).values({
        id: idEndOnly, tenantId: TENANT, code: "COMP016COLS-EONLY", name: "End only",
        endDate: "2026-01-01", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(projectSchemes).where(eq(projectSchemes.tenantId, TENANT))));
    expect(rows.find((r) => r.id === idStartOnly)?.startDate).toBe("2026-01-01");
    expect(rows.find((r) => r.id === idEndOnly)?.endDate).toBe("2026-01-01");
  });
});
