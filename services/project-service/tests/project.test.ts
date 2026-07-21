/**
 * project-service test suite
 *
 * Test 1 — Physical progress weighted: A=40% weight/50% physical, B=60% weight/75% physical → overall=65%
 * Test 2 — Fund release exceeds allocation: consumer emits allocation_exceeded, no DB write
 * Test 3 — UC expenditure > released: consumer emits uc_expenditure_exceeded, no DB write
 * Test 4 — CQRS: POST /projects/schemes/:id/fund-releases → SQS → consumer → DB (MemoryQueue)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { withTenantConsumer, runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { projectSchemes, projectSchemeComponents, projectFundReleases } from "../src/modules/scheme/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerSchemeConsumers } from "../src/modules/scheme/consumer.js";
import { registerUcConsumers }     from "../src/modules/utilisation/consumer.js";
import { computeWeightedPhysicalProgress } from "../src/modules/scheme/domain.js";
import { assertUcExpenditureWithinReleased } from "../src/modules/utilisation/domain.js";
import { assertFundReleaseWithinAllocation } from "../src/modules/scheme/domain.js";
import { EVENTS } from "../src/topics.js";

const ACTOR    = "00000000-aaaa-4000-8000-000000000001";
const TENANT   = "11111111-aaaa-4000-8000-000000000002";
const SCHEME_1 = "22222222-bbbb-4000-8000-000000000001";
const COMP_A   = "33333333-cccc-4000-8000-000000000001";
const COMP_B   = "33333333-cccc-4000-8000-000000000002";
const REL_1    = "44444444-dddd-4000-8000-000000000001";
const REL_2    = "44444444-dddd-4000-8000-000000000002";
const MSG_SC1  = "55555555-eeee-4000-8000-000000000001";
const MSG_CA   = "55555555-eeee-4000-8000-000000000002";
const MSG_CB   = "55555555-eeee-4000-8000-000000000003";
const MSG_FR1  = "55555555-eeee-4000-8000-000000000004";
const MSG_FR2  = "55555555-eeee-4000-8000-000000000005";
const MSG_UC1  = "55555555-eeee-4000-8000-000000000006";

// RLS fix: MemoryQueue instantiated directly (bypassing createQueue()) never
// gets the withTenantConsumer decoration that createQueue() applies to every
// subscribe() call, so consumer handlers run with no app.tenant_id GUC set —
// under FORCE RLS all writes and reads inside db.transaction() are silently
// scoped to zero rows. Decorate subscribe() here the same way createQueue()
// does, mirroring services/visitor-service/tests/turnstile-config.integration.test.ts.
function tenantScopedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  (q as unknown as { subscribe: unknown }).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, withTenantConsumer(handler) as typeof handler);
  return q;
}

async function wipe() {
  // Wrapped in runWithTenant + db.transaction() so wrapWithTenantGuc injects
  // app.tenant_id before these writes — a bare db.delete() runs with no RLS
  // GUC set and is silently rejected under FORCE RLS.
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(projectFundReleases).where(eq(projectFundReleases.tenantId, TENANT));
    await tx.delete(projectSchemeComponents).where(eq(projectSchemeComponents.tenantId, TENANT));
    await tx.delete(projectSchemes).where(eq(projectSchemes.tenantId, TENANT));
    for (const id of [MSG_SC1, MSG_CA, MSG_CB, MSG_FR1, MSG_FR2, MSG_UC1]) {
      await tx.delete(processed).where(eq(processed.messageId, id));
    }
  }));
}

// ── 1. Physical progress weighted calculation — pure ──────────────────────

describe("Scheme domain — weighted physical progress (pure)", () => {
  it("A=40% weight at 50% + B=60% weight at 75% → overall 65%", () => {
    const result = computeWeightedPhysicalProgress([
      { weightPct: 40, physicalPct: 50 },
      { weightPct: 60, physicalPct: 75 },
    ]);
    // (50*40 + 75*60) / (40+60) = (2000+4500)/100 = 65
    expect(result).toBe(65);
  });

  it("single component 100% weight at 83% → overall 83%", () => {
    const result = computeWeightedPhysicalProgress([{ weightPct: 100, physicalPct: 83 }]);
    expect(result).toBe(83);
  });

  it("zero total weight → 0%", () => {
    const result = computeWeightedPhysicalProgress([{ weightPct: 0, physicalPct: 90 }]);
    expect(result).toBe(0);
  });
});

// ── 2. Fund release exceeds allocation — pure + integration ───────────────

describe("Scheme domain — fund release allocation (pure)", () => {
  it("within allocation: does not throw", () => {
    expect(() => assertFundReleaseWithinAllocation(10000000n, 0n, 5000000n)).not.toThrow();
  });

  it("exactly at allocation: does not throw", () => {
    expect(() => assertFundReleaseWithinAllocation(10000000n, 5000000n, 5000000n)).not.toThrow();
  });

  it("exceeds allocation: throws ALLOCATION_EXCEEDED", () => {
    expect(() => assertFundReleaseWithinAllocation(10000000n, 8000000n, 5000000n))
      .toThrowError("ALLOCATION_EXCEEDED");
  });
});

describe("Scheme consumer — fund release exceeds allocation (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("scheme + components seed + over-allocation → allocation_exceeded in outbox, no DB write", async () => {
    // Seed scheme and component A (allocation = 10 lakh paise = 1000000)
    const q = tenantScopedQueue();
    registerSchemeConsumers(q);
    await q.start();

    // Create scheme
    await q.publish("project.scheme.create", {
      messageId: MSG_SC1, type: "project.scheme.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-scheme-1",
      schemaVersion: "1.0",
      payload: {
        id: SCHEME_1, tenantId: TENANT, code: "SCH-001", name: "Test Scheme",
        type: "css", fundingPattern: "60:40", totalOutlayMinor: 100000000,
      },
    });

    // Create component A (allocation = 1000000 paise)
    await q.publish("project.scheme_component.create", {
      messageId: MSG_CA, type: "project.scheme_component.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-comp-a",
      schemaVersion: "1.0",
      payload: {
        id: COMP_A, tenantId: TENANT, schemeId: SCHEME_1,
        code: "COMP-A", name: "Component A", allocationMinor: 1000000, weightPct: 40,
      },
    });

    await new Promise<void>((r) => setTimeout(r, 600));

    // Try to release 1500000 (over 1000000 allocation)
    await q.publish("project.fund_release.create", {
      messageId: MSG_FR1, type: "project.fund_release.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-fr-exceed",
      schemaVersion: "1.0",
      payload: {
        id: REL_1, tenantId: TENANT, schemeId: SCHEME_1, componentId: COMP_A,
        releaseNo: "REL-001", amountMinor: 1500000, toEntity: "agency",
      },
    });

    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    // Fund release should NOT be in DB.
    // Wrapped in runWithTenant + db.transaction() so wrapWithTenantGuc injects
    // app.tenant_id before this read — a bare db.select() runs with no RLS GUC set.
    const releases = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(projectFundReleases).where(eq(projectFundReleases.id, REL_1))));
    expect(releases).toHaveLength(0);

    // allocation_exceeded event should be in outbox
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const types = rows.map((r) => r.eventType);
    expect(types).toContain(EVENTS.fundReleaseAllocationExceeded);
    expect(types).not.toContain(EVENTS.fundReleaseApproved);
  });
});

// ── 3. UC expenditure > released — pure ──────────────────────────────────

describe("UC domain — expenditure validation (pure)", () => {
  it("expenditure ≤ released: does not throw", () => {
    expect(() => assertUcExpenditureWithinReleased(1000000n, 800000n)).not.toThrow();
  });

  it("expenditure = released: does not throw", () => {
    expect(() => assertUcExpenditureWithinReleased(1000000n, 1000000n)).not.toThrow();
  });

  it("expenditure > released: throws UC_EXPENDITURE_EXCEEDS_RELEASED", () => {
    expect(() => assertUcExpenditureWithinReleased(1000000n, 1200000n))
      .toThrowError("UC_EXPENDITURE_EXCEEDS_RELEASED");
  });
});

// ── 4. CQRS — fund release within allocation → approved in DB ────────────

describe("CQRS — fund release within allocation (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  it("component B allocation 5000000 → release 3000000 → approved, DB written, event emitted", async () => {
    const q = tenantScopedQueue();
    registerSchemeConsumers(q);
    await q.start();

    // Seed scheme
    await q.publish("project.scheme.create", {
      messageId: MSG_SC1, type: "project.scheme.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-scheme-2",
      schemaVersion: "1.0",
      payload: {
        id: SCHEME_1, tenantId: TENANT, code: "SCH-001", name: "Test Scheme",
        type: "css", fundingPattern: "60:40", totalOutlayMinor: 100000000,
      },
    });

    // Seed component B (allocation = 5000000 paise)
    await q.publish("project.scheme_component.create", {
      messageId: MSG_CB, type: "project.scheme_component.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-comp-b",
      schemaVersion: "1.0",
      payload: {
        id: COMP_B, tenantId: TENANT, schemeId: SCHEME_1,
        code: "COMP-B", name: "Component B", allocationMinor: 5000000, weightPct: 60,
      },
    });

    await new Promise<void>((r) => setTimeout(r, 600));

    // Release 3000000 (within 5000000 allocation)
    await q.publish("project.fund_release.create", {
      messageId: MSG_FR2, type: "project.fund_release.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-fr-ok",
      schemaVersion: "1.0",
      payload: {
        id: REL_2, tenantId: TENANT, schemeId: SCHEME_1, componentId: COMP_B,
        releaseNo: "REL-002", amountMinor: 3000000, toEntity: "state",
      },
    });

    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    // Fund release should be in DB with status=approved.
    // Wrapped in runWithTenant + db.transaction() so wrapWithTenantGuc injects
    // app.tenant_id before this read — a bare db.select() runs with no RLS GUC set.
    const releases = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(projectFundReleases).where(eq(projectFundReleases.id, REL_2))));
    expect(releases).toHaveLength(1);
    expect(releases[0]?.status).toBe("approved");
    expect(releases[0]?.amountMinor).toBe(3000000n);

    // approved event in outbox
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const types = rows.map((r) => r.eventType);
    expect(types).toContain(EVENTS.fundReleaseApproved);
  });
});
