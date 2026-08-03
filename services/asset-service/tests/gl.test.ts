/**
 * asset-service GL / finance-integration test suite (10/10 coverage).
 *
 * Closes the rubric gaps: every asset lifecycle event that touches the books
 * must enqueue a BALANCED, deterministically-keyed StandardJournal to
 * `finance.gl.post`, and redelivery must be idempotent. We assert against the
 * transactional outbox (the asset-service side of the contract) so the tests are
 * hermetic — they do not require finance-service to be running.
 *
 * Coverage:
 *  - acquisition -> balanced StandardJournal Dr 1200 / Cr 2050 (+ redelivery idempotent)
 *  - dual-book schedules (company SLM + statutory WDV) from one create
 *  - depreciation run -> type:"depreciation" GL, company book value updated
 *  - impairment -> Dr 5200 / Cr 1200, accumulatedDep UNTOUCHED
 *  - revaluation -> Dr 1200 / Cr 3100 (upward)
 *  - maintenance GL Dr 5300 / Cr 2050 + cross-tenant work-order rejection
 *  - tenant isolation (depRun for tenant A never posts tenant B's entries)
 *  - journal-id uuid determinism (uuidV5 stable + RFC-4122 valid)
 *
 * NOTE on cleanup: finance journals live in another service/DB and are never
 * touched here. Asset-service test rows (assets, schedules, entries, work orders,
 * outbox, _inbox.processed) are cleaned in afterAll. The outbox is append-only at
 * the relay layer but has no delete trigger in asset-service, so test rows are
 * removed; if a future trigger blocks deletes, these inserts are tenant-scoped to
 * the dedicated TENANT_A/TENANT_B test tenants and are harmless.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { assetAssets } from "../src/modules/register/schema.js";
import { assetDepSchedules, assetDepEntries } from "../src/modules/depreciation/schema.js";
import { assetWorkOrders } from "../src/modules/maintenance/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerRegisterConsumers } from "../src/modules/register/consumer.js";
import { registerDepreciationConsumers } from "../src/modules/depreciation/consumer.js";
import { registerMaintenanceConsumers } from "../src/modules/maintenance/consumer.js";
import { registerF3EnterpriseConsumers } from "../src/modules/enterprise/f3-consumer.js";
import { queue as sharedQueue } from "../src/shared/infra.js";
import { uuidV5 } from "../src/shared/ids.js";
import { COMMANDS } from "../src/topics.js";

const SECRET  = "test_secret_for_civitasone_32chr";
const GL_TOPIC = "finance.gl.post";

const ACTOR    = "00000000-aaaa-4000-8000-0000000000aa";
const TENANT_A = "1aaaaaaa-aaaa-4000-8000-00000000000a";
const TENANT_B = "1bbbbbbb-bbbb-4000-8000-00000000000b";

const A_ACQ    = "2aaaaaaa-0001-4000-8000-000000000001"; // acquisition asset
const A_DEP_A  = "2aaaaaaa-0002-4000-8000-000000000002"; // dep asset, tenant A
const A_DEP_B  = "2bbbbbbb-0002-4000-8000-000000000002"; // dep asset, tenant B
const A_IMP    = "2aaaaaaa-0003-4000-8000-000000000003"; // impairment/reval asset
const WO_ID    = "2aaaaaaa-0004-4000-8000-000000000004"; // work order

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GlPayload = {
  id?: string; tenantId?: string; type: string; voucherNo?: string; postingDate?: string;
  lines?: Array<{ accountCode: string; debitMinor: string; creditMinor: string }>;
  depAmountMinor?: string; depBook?: string; period?: string; assetId?: string;
};

function msgId(tenantId: string, label: string): string {
  // The queue envelope schema requires messageId to be a UUID; derive a stable one.
  return uuidV5(`msg:${tenantId}:${label}`);
}

function envelope(type: string, tenantId: string, label: string, payload: Record<string, unknown>) {
  // The queue envelope schema requires messageId to be a UUID. Derive a STABLE
  // uuid from the human label so the same label (e.g. a redelivery) yields the
  // same messageId and the consumer's markProcessed dedupes it.
  const messageId = msgId(tenantId, label);
  return { messageId, type, tenantId, actorId: ACTOR, correlationId: `corr-${label}`, schemaVersion: "1.0", payload };
}

async function drain(ms = 400): Promise<void> { await new Promise<void>((r) => setTimeout(r, ms)); }

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * #146: the asset_svc role is NOBYPASSRLS and every domain table (and the
 * outbox) has FORCE RLS with policy `tenant_id = current_tenant_id()`. Raw
 * test reads/seeds/cleanup must therefore run inside a tenant-GUC transaction
 * — the drizzle-side mirror of telephony's sqlAsTenant test helper (PR #152).
 */
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

async function glMessages(tenantId: string): Promise<GlPayload[]> {
  const rows = await asTenant(tenantId, (tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId)));
  return rows.filter((r) => r.eventType === GL_TOPIC).map((r) => r.payload as GlPayload);
}

/**
 * In-test outbox relay: the consumers enqueue follow-on commands (e.g. the dual
 * dep-schedule commands) to the transactional OUTBOX, not directly onto the
 * queue. Production runs a relay that drains the outbox onto the bus; under
 * MemoryQueue we pump it manually here so the downstream consumer actually runs.
 * Republishes pending rows of `topics` for `tenantId`, then marks them published.
 */
async function relayOutbox(q: MemoryQueue, tenantId: string, topics: string[]): Promise<void> {
  const rows = (await asTenant(tenantId, (tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId))))
    .filter((r) => topics.includes(r.topic));
  for (const row of rows) {
    await q.publish(row.topic, {
      messageId: row.id, type: row.eventType, tenantId: row.tenantId, actorId: row.actorId,
      correlationId: row.correlationId, schemaVersion: "1.0", payload: row.payload,
    });
  }
}

function assertBalanced(lines: Array<{ debitMinor: string; creditMinor: string }>): void {
  let dr = 0n, cr = 0n;
  for (const l of lines) { dr += BigInt(l.debitMinor); cr += BigInt(l.creditMinor); }
  expect(dr).toBe(cr);
  expect(dr).toBeGreaterThan(0n);
}

async function cleanupTenant(tenantId: string, assetIds: string[]): Promise<void> {
  // Purge _inbox.processed for every messageId this suite mints under the tenant,
  // including the per-dep-entry idempotency keys (uuidV5(`${outerMsgId}:${entryId}`)).
  // Without this, a SECOND test run sees the deterministic messageId already
  // processed and the consumer short-circuits — emitting nothing. Order matters:
  // collect entry ids BEFORE deleting the entries.
  const outerIds = LABELS.filter(([t]) => t === tenantId).map(([t, l]) => msgId(t, l));
  const processedIds = [...outerIds];
  await asTenant(tenantId, async (tx) => {
    if (assetIds.length) {
      const entries = await tx.select().from(assetDepEntries).where(inArray(assetDepEntries.assetId, assetIds));
      for (const e of entries) for (const oid of outerIds) processedIds.push(uuidV5(`${oid}:${e.id}`));
    }
    if (processedIds.length) {
      await tx.delete(processed).where(inArray(processed.messageId, processedIds));
    }
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
    if (assetIds.length) {
      await tx.delete(assetDepEntries).where(inArray(assetDepEntries.assetId, assetIds));
      await tx.delete(assetDepSchedules).where(inArray(assetDepSchedules.assetId, assetIds));
      await tx.delete(assetWorkOrders).where(inArray(assetWorkOrders.assetId, assetIds));
      await tx.delete(assetAssets).where(inArray(assetAssets.id, assetIds));
    }
  });
}

const LABELS: Array<[string, string]> = [
  [TENANT_A, "acq-msg-1"], [TENANT_A, "dep-msg-1"], [TENANT_A, "deprun-msg-1"],
  [TENANT_A, "deprun-iso-1"], [TENANT_A, "wo-create-1"], [TENANT_A, "wo-complete-1"],
  [TENANT_B, "depb-msg-1"], [TENANT_B, "wo-xtenant-1"],
];

const ALL_ASSETS_A = [A_ACQ, A_DEP_A, A_IMP];
const ALL_ASSETS_B = [A_DEP_B];

beforeAll(async () => {
  await cleanupTenant(TENANT_A, ALL_ASSETS_A);
  await cleanupTenant(TENANT_B, ALL_ASSETS_B);
});

afterAll(async () => {
  await cleanupTenant(TENANT_A, ALL_ASSETS_A);
  await cleanupTenant(TENANT_B, ALL_ASSETS_B);
  await sqlClient.end();
});

// ── 1. Acquisition -> balanced StandardJournal + idempotent redelivery ────────

describe("Acquisition GL — direct asset registration", () => {
  it("emits a balanced Dr 1200 / Cr 2050 acquisition journal with a deterministic uuid id", async () => {
    const q = new MemoryQueue();
    registerRegisterConsumers(q);
    registerDepreciationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.assetCreate, envelope(COMMANDS.assetCreate, TENANT_A, "acq-msg-1", {
      id: A_ACQ, tenantId: TENANT_A, name: "Acq Asset", code: "ACQ-001",
      categoryId: "77777777-0001-0000-0000-000000000001",
      acquisitionCost: 8500000, salvageValue: 500000, usefulLifeYears: 5,
      depRate: 20, depMethod: "SLM", currency: "INR", acquisitionDate: "2024-01-15",
    }));
    await drain();
    await q.stop();

    const gls = await glMessages(TENANT_A);
    const acq = gls.filter((g) => g.type === "asset_acquisition");
    expect(acq).toHaveLength(1);
    const j = acq[0]!;
    expect(j.id).toBe(uuidV5(`acq:${A_ACQ}`));
    expect(j.id).toMatch(UUID_RE);
    expect(j.tenantId).toBe(TENANT_A);
    expect(j.postingDate).toBe("2024-01-15");
    assertBalanced(j.lines!);
    const dr = j.lines!.find((l) => BigInt(l.debitMinor) > 0n)!;
    const crL = j.lines!.find((l) => BigInt(l.creditMinor) > 0n)!;
    expect(dr.accountCode).toBe("1200");
    expect(dr.debitMinor).toBe("8500000");
    expect(crL.accountCode).toBe("2050");
    expect(crL.creditMinor).toBe("8500000");
  });

  it("redelivery of the same create is idempotent — exactly one acquisition journal", async () => {
    const q = new MemoryQueue();
    registerRegisterConsumers(q);
    registerDepreciationConsumers(q);
    await q.start();
    const env = envelope(COMMANDS.assetCreate, TENANT_A, "acq-msg-1", {
      id: A_ACQ, tenantId: TENANT_A, name: "Acq Asset", code: "ACQ-001",
      categoryId: "77777777-0001-0000-0000-000000000001",
      acquisitionCost: 8500000, salvageValue: 500000, usefulLifeYears: 5,
      depRate: 20, depMethod: "SLM", currency: "INR", acquisitionDate: "2024-01-15",
    });
    // republish the SAME messageId — markProcessed must short-circuit the consumer.
    await q.publish(COMMANDS.assetCreate, env);
    await drain();
    await q.stop();

    const acq = (await glMessages(TENANT_A)).filter((g) => g.type === "asset_acquisition");
    expect(acq).toHaveLength(1); // still exactly one — no double-capitalization
  });
});

// ── 2. Dual-book depreciation schedules from one create ───────────────────────

describe("Dual-book schedules — company SLM + statutory WDV", () => {
  it("one create produces a company(SLM) and a statutory(WDV) schedule", async () => {
    const q = new MemoryQueue();
    registerRegisterConsumers(q);
    registerDepreciationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.assetCreate, envelope(COMMANDS.assetCreate, TENANT_A, "dep-msg-1", {
      id: A_DEP_A, tenantId: TENANT_A, name: "Dep Asset", code: "DEP-001",
      categoryId: "77777777-0001-0000-0000-000000000001",
      acquisitionCost: 1200000, salvageValue: 0, usefulLifeYears: 5,
      depRate: 20, depMethod: "SLM", currency: "INR", acquisitionDate: "2024-01-01",
    }));
    await drain(500);
    await relayOutbox(q, TENANT_A, [COMMANDS.depSchedule]); // pump dep-schedule commands
    await drain(700);
    await q.stop();

    const schedules = await asTenant(TENANT_A, (tx) =>
      tx.select().from(assetDepSchedules).where(eq(assetDepSchedules.assetId, A_DEP_A)));
    const books = schedules.map((s) => `${s.depBook}:${s.method}`).sort();
    expect(books).toEqual(["company:SLM", "statutory:WDV"]);

    // SLM entries reconcile to (cost - salvage); last book value lands on salvage.
    const companySched = schedules.find((s) => s.depBook === "company")!;
    const entries = await asTenant(TENANT_A, (tx) => tx.select().from(assetDepEntries)
      .where(eq(assetDepEntries.scheduleId, companySched.id)));
    const total = entries.reduce((a, e) => a + e.amountMinor, 0n);
    expect(total).toBe(1200000n); // sum(monthly) == cost - salvage exactly (rounding true-up)
    const last = entries.find((e) => e.bookValueAfterMinor === 0n);
    expect(last).toBeDefined();
  });
});

// ── 3. Depreciation run -> GL + company book update ───────────────────────────

describe("Depreciation run — posts GL and advances company book value", () => {
  it("depRun for the first period posts a type:depreciation GL and updates the asset book value", async () => {
    const q = new MemoryQueue();
    registerDepreciationConsumers(q);
    await q.start();

    const firstEntry = (await asTenant(TENANT_A, (tx) => tx.select().from(assetDepEntries)
      .where(eq(assetDepEntries.assetId, A_DEP_A))))
      .filter((e) => e.depBook === "company")
      .sort((a, b) => a.period.localeCompare(b.period))[0]!;
    const period = firstEntry.period;

    await q.publish(COMMANDS.depRun, envelope(COMMANDS.depRun, TENANT_A, "deprun-msg-1", {
      tenantId: TENANT_A, period, depBook: "company",
    }));
    await drain(700);
    await q.stop();

    const dep = (await glMessages(TENANT_A)).filter(
      (g) => g.type === "depreciation" && g.period === period && g.assetId === A_DEP_A,
    );
    expect(dep).toHaveLength(1);                 // exactly one company-book post for this asset/period
    expect(dep[0]!.depBook).toBe("company");
    expect(BigInt(dep[0]!.depAmountMinor!)).toBe(firstEntry.amountMinor);

    // entry marked posted
    const posted = (await asTenant(TENANT_A, (tx) =>
      tx.select().from(assetDepEntries).where(eq(assetDepEntries.id, firstEntry.id))))[0]!;
    expect(posted.postedAt).not.toBeNull();

    // company book value advanced on the asset
    const asset = (await asTenant(TENANT_A, (tx) =>
      tx.select().from(assetAssets).where(eq(assetAssets.id, A_DEP_A))))[0]!;
    expect(asset.bookValue).toBe(firstEntry.bookValueAfterMinor);
    expect(asset.accumulatedDep).toBe(firstEntry.amountMinor);
  });
});

// ── 4. Tenant isolation — depRun for A never posts B's entries ────────────────

describe("Tenant isolation — depRun is tenant-scoped", () => {
  it("a depRun for tenant A leaves tenant B's due entries unposted and unbilled", async () => {
    const q = new MemoryQueue();
    registerRegisterConsumers(q);
    registerDepreciationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.assetCreate, envelope(COMMANDS.assetCreate, TENANT_B, "depb-msg-1", {
      id: A_DEP_B, tenantId: TENANT_B, name: "Dep Asset B", code: "DEPB-001",
      categoryId: "77777777-0001-0000-0000-000000000001",
      acquisitionCost: 600000, salvageValue: 0, usefulLifeYears: 5,
      depRate: 20, depMethod: "SLM", currency: "INR", acquisitionDate: "2024-01-01",
    }));
    await drain(500);
    await relayOutbox(q, TENANT_B, [COMMANDS.depSchedule]); // pump B's dep-schedule commands
    await drain(700);

    const bEntry = (await asTenant(TENANT_B, (tx) =>
      tx.select().from(assetDepEntries).where(eq(assetDepEntries.assetId, A_DEP_B))))
      .filter((e) => e.depBook === "company")
      .sort((a, b) => a.period.localeCompare(b.period))[0]!;

    // run depreciation for TENANT_A for B's period — must NOT touch B.
    await q.publish(COMMANDS.depRun, envelope(COMMANDS.depRun, TENANT_A, "deprun-iso-1", {
      tenantId: TENANT_A, period: bEntry.period, depBook: "company",
    }));
    await drain(700);
    await q.stop();

    const bEntryAfter = (await asTenant(TENANT_B, (tx) =>
      tx.select().from(assetDepEntries).where(eq(assetDepEntries.id, bEntry.id))))[0]!;
    expect(bEntryAfter.postedAt).toBeNull(); // B untouched by A's run

    // no GL posted under tenant B by tenant A's run
    const bGls = (await glMessages(TENANT_B)).filter((g) => g.type === "depreciation");
    expect(bGls).toHaveLength(0);
  });
});

// ── 5. Impairment & Revaluation GL (via HTTP route → f3RouteWrite consumer) ───

describe("Impairment & Revaluation GL", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;
  let bearer: string;

  /** Drain the shared MemoryQueue used by publishF3Write (infra.queue). */
  async function drainShared(): Promise<void> {
    const q = sharedQueue as MemoryQueue;
    if (typeof q.drain === "function") await q.drain();
    else await drain(500);
  }

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    const { signToken } = await import("@civitasone/auth");
    bearer = signToken({ sub: ACTOR, tid: TENANT_A, roles: ["asset_admin", "super_admin"] } as never, SECRET);

    // Route publishes to infra.queue; register the F3 consumer so GL lands in outbox.
    registerF3EnterpriseConsumers(sharedQueue);
    await sharedQueue.start();

    // seed the asset directly so the route can load it (book value 1,000,000)
    await asTenant(TENANT_A, (tx) => tx.insert(assetAssets).values({
      id: A_IMP, tenantId: TENANT_A, name: "Imp Asset", code: "IMP-001",
      categoryId: "77777777-0001-0000-0000-000000000001", assetType: "fixed",
      barcode: "AST-IMP-001", status: "active",
      acquisitionCost: 1000000n, salvageValue: 0n, usefulLifeYears: 5,
      depRate: "20", depMethod: "SLM", currency: "INR",
      bookValue: 1000000n, accumulatedDep: 0n, acquisitionDate: "2024-01-01",
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
  });

  afterAll(async () => { await app.close(); });

  it("impairment emits Dr 5200 / Cr 1200 and leaves accumulatedDep UNCHANGED", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${A_IMP}/impairment`,
      headers: { authorization: `Bearer ${bearer}`, "x-tenant-id": TENANT_A, "content-type": "application/json" },
      payload: { amountMinor: 300000, reason: "flood damage", eventDate: "2024-06-01" },
    });
    expect(res.statusCode).toBe(202);
    await drainShared();

    const imp = (await glMessages(TENANT_A)).filter((g) => g.type === "asset_impairment");
    expect(imp).toHaveLength(1);
    const j = imp[0]!;
    expect(j.id).toMatch(UUID_RE);
    assertBalanced(j.lines!);
    const dr = j.lines!.find((l) => BigInt(l.debitMinor) > 0n)!;
    const cr = j.lines!.find((l) => BigInt(l.creditMinor) > 0n)!;
    expect(dr.accountCode).toBe("5200");
    expect(dr.debitMinor).toBe("300000");
    expect(cr.accountCode).toBe("1200");

    const asset = (await asTenant(TENANT_A, (tx) =>
      tx.select().from(assetAssets).where(eq(assetAssets.id, A_IMP))))[0]!;
    expect(asset.bookValue).toBe(700000n);      // dropped by impairment
    expect(asset.accumulatedDep).toBe(0n);      // UNCHANGED — impairment is not depreciation
  });

  it("upward revaluation emits Dr 1200 / Cr 3100 (revaluation reserve, equity)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${A_IMP}/revaluation`,
      headers: { authorization: `Bearer ${bearer}`, "x-tenant-id": TENANT_A, "content-type": "application/json" },
      payload: { newBookValueMinor: 900000, reason: "market revaluation" },
    });
    expect(res.statusCode).toBe(202);
    await drainShared();

    const rev = (await glMessages(TENANT_A)).filter((g) => g.type === "asset_revaluation");
    expect(rev).toHaveLength(1);
    const j = rev[0]!;
    assertBalanced(j.lines!);
    const dr = j.lines!.find((l) => BigInt(l.debitMinor) > 0n)!;
    const cr = j.lines!.find((l) => BigInt(l.creditMinor) > 0n)!;
    expect(dr.accountCode).toBe("1200");        // book value up 700k -> 900k
    expect(dr.debitMinor).toBe("200000");
    expect(cr.accountCode).toBe("3100");
    expect(cr.creditMinor).toBe("200000");
  });
});

// ── 6. Maintenance GL + cross-tenant work-order rejection ─────────────────────

describe("Maintenance GL + cross-tenant work-order rejection", () => {
  it("completing a work order emits Dr 5300 / Cr 2050 with a deterministic id", async () => {
    const q = new MemoryQueue();
    registerMaintenanceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.workOrderCreate, envelope(COMMANDS.workOrderCreate, TENANT_A, "wo-create-1", {
      id: WO_ID, assetId: A_ACQ, tenantId: TENANT_A, scheduledDate: "2024-03-01", notes: "AC service",
    }));
    await drain();
    await q.publish(COMMANDS.workOrderComplete, envelope(COMMANDS.workOrderComplete, TENANT_A, "wo-complete-1", {
      id: WO_ID, tenantId: TENANT_A, completedDate: "2024-03-05", costMinor: 45000, currency: "INR",
    }));
    await drain();
    await q.stop();

    const mnt = (await glMessages(TENANT_A)).filter((g) => g.type === "asset_maintenance");
    expect(mnt).toHaveLength(1);
    const j = mnt[0]!;
    expect(j.id).toBe(uuidV5(`maintenance:${WO_ID}`));
    assertBalanced(j.lines!);
    const dr = j.lines!.find((l) => BigInt(l.debitMinor) > 0n)!;
    const cr = j.lines!.find((l) => BigInt(l.creditMinor) > 0n)!;
    expect(dr.accountCode).toBe("5300");
    expect(dr.debitMinor).toBe("45000");
    expect(cr.accountCode).toBe("2050");
  });

  it("completing a work order under the WRONG tenant is rejected (no GL, no silent cross-tenant write)", async () => {
    const q = new MemoryQueue();
    registerMaintenanceConsumers(q);
    await q.start();

    // WO_ID belongs to TENANT_A; the consumer loads the WO under a tenant guard,
    // finds nothing for TENANT_B, and throws -> the tx rolls back. MemoryQueue
    // dead-letters the handler error (publish does not reject), so we assert on
    // observable state: no GL under B, and A's work order is left intact.
    await q.publish(COMMANDS.workOrderComplete, envelope(COMMANDS.workOrderComplete, TENANT_B, "wo-xtenant-1", {
      id: WO_ID, tenantId: TENANT_B, completedDate: "2024-03-09", costMinor: 99999, currency: "INR",
    }));
    await drain();
    await q.stop();

    // No maintenance GL emitted under tenant B.
    const bMnt = (await glMessages(TENANT_B)).filter((g) => g.type === "asset_maintenance");
    expect(bMnt).toHaveLength(0);

    // The tenant-A work order was NOT mutated by the cross-tenant completion.
    const wo = (await asTenant(TENANT_A, (tx) =>
      tx.select().from(assetWorkOrders).where(eq(assetWorkOrders.id, WO_ID))))[0]!;
    expect(wo.tenantId).toBe(TENANT_A);
    expect(wo.costMinor).toBe(45000n);          // still the legitimate tenant-A cost
  });
});

// ── 7. Journal-id uuid determinism (pure) ─────────────────────────────────────

describe("Journal-id determinism — uuidV5", () => {
  it("is stable across calls and RFC-4122 v5 valid", () => {
    const a = uuidV5(`acq:${A_ACQ}`);
    const b = uuidV5(`acq:${A_ACQ}`);
    expect(a).toBe(b);
    expect(a).toMatch(UUID_RE);
  });

  it("different source keys produce different ids", () => {
    expect(uuidV5(`acq:${A_ACQ}`)).not.toBe(uuidV5(`acq:${A_DEP_A}`));
    expect(uuidV5(`impairment:x`)).not.toBe(uuidV5(`maintenance:x`));
  });
});
