/**
 * fp-assets-01 finish batch, real Postgres (NOBYPASSRLS app role, so FORCE RLS applies):
 *  DEPRECIATION-02  status/preview endpoint + 409 ALREADY_POSTED
 *  LOCATIONS-02/03  deactivate / reactivate (children rule, idempotent), asset -> locationId
 *  SCAN-06          barcode unique per tenant, tenant-scoped lookup, every scan logged
 *  MAINT-NEW-06     one open work order per asset + type (route 409 + unique-index backstop)
 *  PROJECTS-09      maker != checker capitalisation, GL journal, capitalisation date, audit
 *  LEASES-04/07     discounted liability + amortisation schedule persisted, GL recognition
 *  LIST-06          list `total`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages as outbox } from "../src/shared/outbox.js";
import { assetAssets } from "../src/modules/register/schema.js";
import { assetDepSchedules, assetDepEntries } from "../src/modules/depreciation/schema.js";
import { assetWorkOrders } from "../src/modules/maintenance/schema.js";
import {
  functionalLocations, projectAuc, assetLeases, leaseScheduleRows, assetScanLog, assetSettings, assetSettingRequests, assetImpairments,
} from "../src/modules/enterprise/schema.js";
import { registerF3EnterpriseConsumers } from "../src/modules/enterprise/f3-consumer.js";
import { registerMaintenanceConsumers } from "../src/modules/maintenance/consumer.js";
import { registerRegisterConsumers } from "../src/modules/register/consumer.js";
import { registerInsuranceConsumers } from "../src/modules/insurance/consumer.js";
import { assetPolicies, assetClaims } from "../src/modules/insurance/schema.js";
import { COMMANDS } from "../src/topics.js";
import { resetFinanceCache } from "../src/shared/finance-client.js";
import { queue as infraQueue } from "../src/shared/infra.js";

// Storage is mocked: claim attachments are verified to exist (HEAD) before a claim accepts them.
const { storageExists } = vi.hoisted(() => ({ storageExists: vi.fn(async (_key: string) => true) }));
vi.mock("@civitasone/storage", () => ({ objectExists: storageExists }));

const TEST_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test_internal_secret_for_civitasone"; // gitleaks:allow
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "aaaaaaaa-1111-4000-8000-0000000fa001";
const T2 = "aaaaaaaa-1111-4000-8000-0000000fa002";
const MAKER = "cccccccc-3333-4000-8000-0000000fa001";
const CHECKER = "cccccccc-3333-4000-8000-0000000fa002";
const tok = (tid: string, sub: string, roles = ["asset_admin"]) => signToken({ sub, tid, roles, sid: `s-${sub.slice(-4)}` }, SECRET, 3600);
const auth = (tid = T1, sub = MAKER, roles?: string[]) => ({ authorization: `Bearer ${tok(tid, sub, roles)}` });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(tid: string, fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(tid, () => db.transaction(fn)) as Promise<T>;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let app: FastifyInstance;
let q: MemoryQueue;

async function f3(op: string, payload: Record<string, unknown>, tid = T1, actor = MAKER): Promise<void> {
  await q.publish(COMMANDS.f3RouteWrite, {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: tid, actorId: actor,
    correlationId: "corr-fp01", schemaVersion: "1.0",
    payload: { op, tenantId: tid, ...payload },
  });
  await wait(450);
}
const outboxFor = async (tid: string, topic: string, pred: (p: Record<string, any>) => boolean) =>
  (await asTenant(tid, (tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, tid), eq(outbox.topic, topic)))))
    .map((r) => r.payload as Record<string, any>).filter(pred);

async function seedAsset(tid: string, code: string, extra: Partial<typeof assetAssets.$inferInsert> = {}): Promise<string> {
  const id = randomUUID();
  await asTenant(tid, (tx) => tx.insert(assetAssets).values({
    id, tenantId: tid, name: `Asset ${code}`, code, categoryId: randomUUID(), acquisitionDate: "2025-01-01",
    createdBy: MAKER, updatedBy: MAKER, ...extra,
  }));
  return id;
}

beforeAll(async () => {
  process.env.INTERNAL_SERVICE_SECRET = TEST_SERVICE_SECRET;
  installFinanceChart();
  app = await buildApp();
  await app.ready();
  q = new MemoryQueue();
  registerF3EnterpriseConsumers(q);
  registerMaintenanceConsumers(q);
  registerRegisterConsumers(q);
  registerInsuranceConsumers(q);
  await q.start();
});

afterAll(async () => {
  await q.stop();
  for (const t of [T1, T2]) {
    await sqlClient`delete from _outbox.messages where tenant_id = ${t}`;
    await asTenant(t, async (tx) => {
      await tx.delete(assetImpairments).where(eq(assetImpairments.tenantId, t));
      await tx.delete(assetClaims).where(eq(assetClaims.tenantId, t));
      await tx.delete(assetPolicies).where(eq(assetPolicies.tenantId, t));
      await tx.delete(leaseScheduleRows).where(eq(leaseScheduleRows.tenantId, t));
      await tx.delete(assetLeases).where(eq(assetLeases.tenantId, t));
      await tx.delete(assetScanLog).where(eq(assetScanLog.tenantId, t));
      await tx.delete(assetSettings).where(eq(assetSettings.tenantId, t));
      await tx.delete(assetSettingRequests).where(eq(assetSettingRequests.tenantId, t));
      await tx.delete(projectAuc).where(eq(projectAuc.tenantId, t));
      await tx.delete(assetWorkOrders).where(eq(assetWorkOrders.tenantId, t));
      await tx.delete(assetDepEntries).where(eq(assetDepEntries.tenantId, t));
      await tx.delete(assetDepSchedules).where(eq(assetDepSchedules.tenantId, t));
      await tx.delete(functionalLocations).where(eq(functionalLocations.tenantId, t));
      await tx.delete(assetAssets).where(eq(assetAssets.tenantId, t));
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("GAP-ASSETS-DEPRECIATION-02: status preview + already-posted", () => {
  const ASSET = randomUUID();
  const SCHED = randomUUID();
  const ids = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    await asTenant(T1, async (tx) => {
      await tx.insert(assetAssets).values({ id: ASSET, tenantId: T1, name: "Pump", code: "DEP-1", categoryId: randomUUID(), acquisitionDate: "2025-01-01", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetDepSchedules).values({
        id: SCHED, tenantId: T1, assetId: ASSET, method: "SLM", rate: "20", usefulLifeYears: 5, startDate: "2026-01-01", endDate: "2031-01-01",
        originalCostMinor: 100000n, depBook: "company", createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(assetDepEntries).values([
        { id: ids[0]!, tenantId: T1, assetId: ASSET, scheduleId: SCHED, period: "2026-08", amountMinor: 1500n, bookValueAfterMinor: 98500n, depBook: "company", postedAt: new Date("2026-09-02T05:00:00Z"), createdBy: MAKER, updatedBy: MAKER },
        { id: ids[1]!, tenantId: T1, assetId: ASSET, scheduleId: SCHED, period: "2026-09", amountMinor: 1700n, bookValueAfterMinor: 96800n, depBook: "company", createdBy: MAKER, updatedBy: MAKER },
      ]);
    });
  });

  it("reports pending vs posted per book and the last posted period", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/assets/depreciation/status?period=2026-09", headers: auth() });
    expect(res.statusCode).toBe(200);
    const b = JSON.parse(res.body) as { books: Array<Record<string, unknown>>; lastPosted: { period: string } | null };
    expect(b.books).toEqual([expect.objectContaining({ depBook: "company", pendingCount: 1, pendingMinor: "1700", postedCount: 0, postedMinor: "0" })]);
    expect(b.lastPosted?.period).toBe("2026-08");
  });

  it("answers 409 ALREADY_POSTED for a fully posted period, 202 while an entry is pending, 400 for a bad period", async () => {
    const posted = await app.inject({ method: "POST", url: "/v1/assets/depreciation/run", headers: auth(), payload: { period: "2026-08" } });
    expect(posted.statusCode).toBe(409);
    expect(JSON.parse(posted.body).code).toBe("ALREADY_POSTED");
    const pending = await app.inject({ method: "POST", url: "/v1/assets/depreciation/run", headers: auth(), payload: { period: "2026-09" } });
    expect(pending.statusCode).toBe(202);
    const bad = await app.inject({ method: "GET", url: "/v1/assets/depreciation/status?period=Sept", headers: auth() });
    expect(bad.statusCode).toBe(400);
  });

  it("is tenant scoped: another tenant sees no books for the period", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/assets/depreciation/status?period=2026-09", headers: auth(T2) });
    expect(JSON.parse(res.body)).toMatchObject({ books: [], lastPosted: null });
  });
});

describe("GAP-ASSETS-LOCATIONS-02/-03: deactivate, reactivate, asset -> location", () => {
  const PARENT = randomUUID();
  const CHILD = randomUUID();

  it("creates a parent and a child through the consumer", async () => {
    await f3("location_create", { id: PARENT, code: "BLK-A", name: "Block A" });
    await f3("location_create", { id: CHILD, code: "BLK-A-1", name: "Block A floor 1", parentId: PARENT });
    const rows = await asTenant(T1, (tx) => tx.select().from(functionalLocations).where(eq(functionalLocations.tenantId, T1)));
    expect(rows.map((r) => r.code).sort()).toEqual(["BLK-A", "BLK-A-1"]);
    expect(rows.every((r) => r.isActive)).toBe(true);
  });

  it("refuses to deactivate a parent with an active child (route 409 AND consumer no-op)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/assets/locations/${PARENT}/deactivate`, headers: auth(), payload: { reason: "Block closed" } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("HAS_ACTIVE_CHILDREN");
    await f3("location_deactivate", { id: PARENT, reason: "Block closed" }); // racing past the route pre-check
    const [p] = await asTenant(T1, (tx) => tx.select().from(functionalLocations).where(eq(functionalLocations.id, PARENT)));
    expect(p!.isActive).toBe(true);
  });

  it("requires a reason, deactivates the child once (a replay adds no second audit) and audits the actor", async () => {
    const noReason = await app.inject({ method: "POST", url: `/v1/assets/locations/${CHILD}/deactivate`, headers: auth(), payload: {} });
    expect(noReason.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/v1/assets/locations/${CHILD}/deactivate`, headers: auth(), payload: { reason: "Floor demolished" } });
    expect(ok.statusCode).toBe(202);
    await f3("location_deactivate", { id: CHILD, reason: "Floor demolished" });
    await f3("location_deactivate", { id: CHILD, reason: "Floor demolished" });
    const [c] = await asTenant(T1, (tx) => tx.select().from(functionalLocations).where(eq(functionalLocations.id, CHILD)));
    expect(c!.isActive).toBe(false);
    expect(c!.deactivatedBy).toBe(MAKER);
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === CHILD && p.action === "deactivate");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.details.reason).toBe("Floor demolished");
    const again = await app.inject({ method: "POST", url: `/v1/assets/locations/${CHILD}/deactivate`, headers: auth(), payload: { reason: "Floor demolished" } });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).code).toBe("ALREADY_INACTIVE");
  });

  it("lists inactive rows by default and hides them with ?active=true", async () => {
    const all = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/locations", headers: auth() })).body).data as Array<{ id: string; isActive: boolean }>;
    expect(all.find((r) => r.id === CHILD)?.isActive).toBe(false);
    const active = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/locations?active=true", headers: auth() })).body).data as Array<{ id: string }>;
    expect(active.map((r) => r.id)).toEqual([PARENT]);
  });

  it("does not let another tenant deactivate it", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/assets/locations/${CHILD}/reactivate`, headers: auth(T2) });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an asset placed in an unknown or deactivated location, accepts an active one", async () => {
    const body = (locationId: string) => ({
      name: "Chair", code: `CH-${randomUUID().slice(0, 6)}`, categoryId: randomUUID(), acquisitionCost: 1000, acquisitionDate: "2025-01-01", locationId,
    });
    expect((await app.inject({ method: "POST", url: "/v1/assets/assets", headers: auth(), payload: body(randomUUID()) })).statusCode).toBe(400);
    const inactive = await app.inject({ method: "POST", url: "/v1/assets/assets", headers: auth(), payload: body(CHILD) });
    expect(inactive.statusCode).toBe(409);
    expect(JSON.parse(inactive.body).code).toBe("LOCATION_INACTIVE");
    expect((await app.inject({ method: "POST", url: "/v1/assets/assets", headers: auth(), payload: body(PARENT) })).statusCode).toBe(202);
  });

  it("persists location_id through the create consumer", async () => {
    const id = randomUUID();
    await q.publish(COMMANDS.assetCreate, {
      messageId: randomUUID(), type: COMMANDS.assetCreate, tenantId: T1, actorId: MAKER, correlationId: "c", schemaVersion: "1.0",
      payload: { id, tenantId: T1, name: "Desk", code: "DESK-LOC", categoryId: randomUUID(), acquisitionCost: 5000, acquisitionDate: "2025-01-01", location: "Block A", locationId: PARENT },
    });
    await wait(450);
    const [a] = await asTenant(T1, (tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, id)));
    expect(a!.locationId).toBe(PARENT);
    expect(a!.location).toBe("Block A");
  });

  it("reactivates (parent first): a child under an inactive parent is refused", async () => {
    await f3("location_deactivate", { id: PARENT, reason: "Block closed" }); // child already inactive -> allowed now
    const blocked = await app.inject({ method: "POST", url: `/v1/assets/locations/${CHILD}/reactivate`, headers: auth() });
    expect(blocked.statusCode).toBe(409);
    expect(JSON.parse(blocked.body).code).toBe("PARENT_INACTIVE");
    await f3("location_reactivate", { id: PARENT });
    await f3("location_reactivate", { id: CHILD });
    const rows = await asTenant(T1, (tx) => tx.select().from(functionalLocations).where(eq(functionalLocations.tenantId, T1)));
    expect(rows.every((r) => r.isActive)).toBe(true);
  });
});

describe("GAP-ASSETS-SCAN-06: barcode uniqueness, tenant-scoped scan, scan log", () => {
  let a1: string;
  let a2: string;
  beforeAll(async () => {
    a1 = await seedAsset(T1, "SCAN-1", { barcode: "BC-SCAN-1" });
    a2 = await seedAsset(T1, "SCAN-2", { barcode: "BC-SCAN-2" });
  });

  it("a scan hits only within its own tenant (the other tenant gets 404, never the asset)", async () => {
    const own = await app.inject({ method: "GET", url: "/v1/assets/scan/BC-SCAN-1", headers: auth(T1) });
    expect(own.statusCode).toBe(200);
    expect(JSON.parse(own.body).id).toBe(a1);
    const other = await app.inject({ method: "GET", url: "/v1/assets/scan/BC-SCAN-1", headers: auth(T2) });
    expect(other.statusCode).toBe(404);
  });

  it("the scan_log command writes one row per scan, hit or miss", async () => {
    await f3("scan_log", { id: randomUUID(), barcode: "BC-SCAN-1", assetId: a1, found: true });
    await f3("scan_log", { id: randomUUID(), barcode: "NOPE", assetId: null, found: false }, T1, CHECKER);
    const rows = await asTenant(T1, (tx) => tx.select().from(assetScanLog).where(eq(assetScanLog.tenantId, T1)));
    expect(rows.map((r) => [r.barcode, r.found, r.scannedBy]).sort()).toEqual([["BC-SCAN-1", true, MAKER], ["NOPE", false, CHECKER]].sort());
    expect(await asTenant(T2, (tx) => tx.select().from(assetScanLog))).toHaveLength(0);
  });

  it("refuses to tag a barcode that another asset already holds, but allows re-tagging the same asset", async () => {
    const dup = await app.inject({ method: "PATCH", url: `/v1/assets/assets/${a2}/barcode`, headers: auth(), payload: { barcode: "BC-SCAN-1" } });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).code).toBe("DUPLICATE_BARCODE");
    const same = await app.inject({ method: "PATCH", url: `/v1/assets/assets/${a1}/barcode`, headers: auth(), payload: { barcode: "BC-SCAN-1" } });
    expect(same.statusCode).toBe(202);
    const create = await app.inject({
      method: "POST", url: "/v1/assets/assets", headers: auth(),
      payload: { name: "X", code: "SCAN-3", categoryId: randomUUID(), acquisitionCost: 1, acquisitionDate: "2025-01-01", barcode: "BC-SCAN-2" },
    });
    expect(create.statusCode).toBe(409);
  });

  it("a racing tag that loses on the unique index is recorded as an audited failure, not silently dropped (and does not retry)", async () => {
    const holder = await seedAsset(T1, "SCAN-H", { barcode: "BC-HELD" });
    const loser = await seedAsset(T1, "SCAN-L");
    await q.publish(COMMANDS.assetTagBarcode, {
      messageId: randomUUID(), type: COMMANDS.assetTagBarcode, tenantId: T1, actorId: MAKER, correlationId: "c", schemaVersion: "1.0",
      payload: { id: loser, tenantId: T1, barcode: "BC-HELD" }, // bypasses the route pre-check, as a true race would
    });
    await wait(500);
    const [row] = await asTenant(T1, (tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, loser)));
    expect(row!.barcode).toBeNull();
    const [kept] = await asTenant(T1, (tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, holder)));
    expect(kept!.barcode).toBe("BC-HELD");
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === loser && p.action === "tag_barcode");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: "failure", details: { failure: "DUPLICATE_BARCODE", barcode: "BC-HELD" } });
  });

  it("the database itself rejects a duplicate barcode (racing tags cannot both win)", async () => {
    await expect(asTenant(T1, (tx) => tx.update(assetAssets).set({ barcode: "BC-SCAN-1" }).where(eq(assetAssets.id, a2)))).rejects.toThrow();
    // another tenant may reuse the same string
    await expect(seedAsset(T2, "SCAN-X", { barcode: "BC-SCAN-1" })).resolves.toBeTruthy();
  });
});

describe("GAP-ASSETS-MAINTENANCE-NEW-06: one open work order per asset + type", () => {
  let asset: string;
  beforeAll(async () => { asset = await seedAsset(T1, "WO-1"); });

  async function createWo(id: string, type?: string, tid = T1) {
    await q.publish(COMMANDS.workOrderCreate, {
      messageId: randomUUID(), type: COMMANDS.workOrderCreate, tenantId: tid, actorId: MAKER, correlationId: "c", schemaVersion: "1.0",
      payload: { id, tenantId: tid, assetId: asset, scheduledDate: "2026-10-20", ...(type ? { maintenanceType: type } : {}) },
    });
  }

  it("409s an identical open work order, allows a different type, and allows a new one once the first is completed", async () => {
    const first = randomUUID();
    await createWo(first, "breakdown");
    await wait(450);
    const dup = await app.inject({ method: "POST", url: "/v1/assets/work-orders", headers: auth(), payload: { assetId: asset, scheduledDate: "2026-10-21", maintenanceType: "breakdown" } });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).code).toBe("DUPLICATE_OPEN_WORK_ORDER");
    const other = await app.inject({ method: "POST", url: "/v1/assets/work-orders", headers: auth(), payload: { assetId: asset, scheduledDate: "2026-10-21", maintenanceType: "preventive" } });
    expect(other.statusCode).toBe(202);
    await asTenant(T1, (tx) => tx.update(assetWorkOrders).set({ status: "completed" }).where(eq(assetWorkOrders.id, first)));
    const again = await app.inject({ method: "POST", url: "/v1/assets/work-orders", headers: auth(), payload: { assetId: asset, scheduledDate: "2026-10-22", maintenanceType: "breakdown" } });
    expect(again.statusCode).toBe(202);
  });

  it("the unique index lets exactly one of two racing creates persist (and the default type counts as corrective)", async () => {
    await Promise.all([createWo(randomUUID()), createWo(randomUUID())]);
    await wait(700);
    const rows = await asTenant(T1, (tx) => tx.select().from(assetWorkOrders).where(and(eq(assetWorkOrders.assetId, asset), eq(assetWorkOrders.maintenanceType, "corrective"))));
    expect(rows).toHaveLength(1);
    const route = await app.inject({ method: "POST", url: "/v1/assets/work-orders", headers: auth(), payload: { assetId: asset, scheduledDate: "2026-10-23" } });
    expect(route.statusCode).toBe(409);
    // the race loser is an audited FAILURE and its message is marked processed (no retry loop)
    const failures = await outboxFor(T1, "audit.event.record", (p) => p.resourceType === "work_order" && p.outcome === "failure");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.details).toMatchObject({ failure: "DUPLICATE_OPEN_WORK_ORDER", assetId: asset, maintenanceType: "corrective" });
  });
});

// ── GL heads: no defaults, validated against the finance chart, per-tenant settings ─────────────────────────────
const CHART: Record<string, { name: string; type: string; status?: string; isLeaf?: boolean }> = {
  "1200": { name: "Fixed assets", type: "asset" },
  "1250": { name: "Accumulated depreciation", type: "asset" },
  "5200": { name: "Impairment loss", type: "expense" },
  "3100": { name: "Revaluation reserve", type: "equity" },
  "4100": { name: "Miscellaneous income", type: "income" },
  "1260": { name: "Provision for wear", type: "asset" }, // an accumulated-depreciation account with an innocent name and another code
  "1300": { name: "Capital work in progress", type: "asset" },
  "1301": { name: "Old CWIP", type: "asset", status: "inactive" },
  "1400": { name: "Right-of-use assets", type: "asset" },
  "2300": { name: "Lease liability", type: "liability" },
  "2390": { name: "Lease clearing", type: "liability" },
  "3000": { name: "General reserve", type: "equity" },
};
let financeDown = false;
let financeAccumDep = "1250"; // what finance reports as the account it posts depreciation to
let systemHeadsStatus = 200;
const financeCalls: Array<{ url: string; headers: Record<string, string> }> = [];
function installFinanceChart(): void {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.includes("/v1/finance/accounts")) return real(input, init);
    financeCalls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (financeDown) throw new Error("connect ECONNREFUSED");
    if (url.includes("/v1/finance/accounts/system-heads")) {
      return new Response(JSON.stringify({ accumulatedDepreciationCode: financeAccumDep, fixedAssetCode: "1200" }), { status: systemHeadsStatus });
    }
    const term = (new URL(url).searchParams.get("q") ?? "").toLowerCase();
    const data = Object.entries(CHART)
      .filter(([code, v]) => code.includes(term) || v.name.toLowerCase().includes(term))
      .map(([code, v]) => ({ id: randomUUID(), code, name: v.name, type: v.type, status: v.status ?? "active", isLeaf: v.isLeaf ?? true }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
}
const settingsRow = async (tid = T1) => (await asTenant(tid, (tx) => tx.select().from(assetSettings).where(eq(assetSettings.tenantId, tid))))[0] ?? null;
const clearSettings = async (tid = T1) => {
  await asTenant(tid, async (tx) => {
    await tx.delete(assetSettings).where(eq(assetSettings.tenantId, tid));
    await tx.delete(assetSettingRequests).where(eq(assetSettingRequests.tenantId, tid));
  });
};
// head edits apply directly only while GL maker-checker is OFF (fp-assets-02), so the setup turns it off first
const setSettings = async (patch: Record<string, unknown>, actor = MAKER) => {
  await asTenant(T1, (tx) => tx.insert(assetSettings).values({ tenantId: T1, updatedBy: actor, glMakerChecker: false })
    .onConflictDoUpdate({ target: assetSettings.tenantId, set: { glMakerChecker: false } }));
  await f3("asset_settings_update", { reason: "test setup", ...patch }, T1, actor);
};
// writes the table directly, bypassing the consumer's validation: simulates a stale / wrong value already stored
const forceSettings = (patch: Record<string, unknown>) => asTenant(T1, (tx) => tx.insert(assetSettings).values({ tenantId: T1, updatedBy: MAKER, ...patch })
  .onConflictDoUpdate({ target: assetSettings.tenantId, set: patch }));
const getSettings = async () => JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/settings", headers: auth() })).body) as Record<string, any>;
const glEvent = async (topic: string, payload: Record<string, unknown>, tid = T1) => {
  await q.publish(topic, { messageId: randomUUID(), type: topic, tenantId: tid, actorId: MAKER, correlationId: "c", schemaVersion: "1.0", payload });
  await wait(450);
};

describe("GL heads: no defaults, validated against finance, per-tenant settings", () => {
  it("has no default heads: a fresh tenant reports every head as unset", async () => {
    await clearSettings();
    expect(await getSettings()).toMatchObject({
      capitalizeMakerChecker: true, cwipAccountCode: null, fixedAssetAccountCode: null, impairmentExpenseAccountCode: null, revaluationReserveAccountCode: null, rouAccountCode: null, leaseLiabilityAccountCode: null, leaseOffsetAccountCode: null, pendingMakerCheckerOff: null,
    });
  });

  it("validates each head against the finance chart over the internal path before storing it", async () => {
    const patch = (payload: Record<string, unknown>, roles?: string[]) =>
      app.inject({ method: "PATCH", url: "/v1/assets/settings", headers: auth(T1, MAKER, roles), payload: { reason: "configure GL", ...payload } });
    const reject = async (payload: Record<string, unknown>, code: string, status = 409) => {
      const res = await patch(payload);
      expect(res.statusCode).toBe(status);
      expect(JSON.parse(res.body).code).toBe(code);
      return JSON.parse(res.body).message as string;
    };
    expect(await reject({ cwipAccountCode: "1250" }, "GL_HEAD_INVALID")).toMatch(/accumulated-depreciation/);
    expect(await reject({ cwipAccountCode: "2300" }, "GL_HEAD_INVALID")).toMatch(/wrong account type/);
    expect(await reject({ cwipAccountCode: "9999" }, "GL_HEAD_INVALID")).toMatch(/does not exist/);
    expect(await reject({ cwipAccountCode: "1301" }, "GL_HEAD_INVALID")).toMatch(/inactive/);
    expect(await reject({ leaseLiabilityAccountCode: "1400" }, "GL_HEAD_INVALID")).toMatch(/wrong account type/);
    financeDown = true;
    await reject({ cwipAccountCode: "1300" }, "FINANCE_UNAVAILABLE", 503);
    financeDown = false;
    expect((await patch({ cwipAccountCode: "1300" }, ["asset_manager"])).statusCode).toBe(403); // approvers only
    expect(await settingsRow()).toBeNull(); // nothing was stored by any refusal
    const ok = await patch({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300", leaseOffsetAccountCode: "2390" });
    expect(ok.statusCode).toBe(202);
    const call = financeCalls.at(-1)!;
    expect(call.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": T1, "x-service-secret": TEST_SERVICE_SECRET });
    expect(call.url).toContain("/v1/finance/accounts?q=");
  });

  it("the consumer stores the heads and audits a before/after image", async () => {
    await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300", leaseOffsetAccountCode: "2390" }, CHECKER);
    expect(await getSettings()).toMatchObject({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300", leaseOffsetAccountCode: "2390" });
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceType === "asset_settings" && p.action === "update");
    const last = audits.at(-1)!;
    expect(last.details.before).toMatchObject({ cwipAccountCode: null, rouAccountCode: null });
    expect(last.details.after).toMatchObject({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300", leaseOffsetAccountCode: "2390" });
    expect(last.outcome).toBe("success");
  });
});

describe("GL head rules: distinct heads, fixed-asset head per tenant, accumulated depreciation asked from finance", () => {
  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: "/v1/assets/settings", headers: auth(), payload: { reason: "configure GL", ...payload } });

  it("rejects a head that equals another configured head or the fixed-asset debit head (Dr X / Cr X would net to nothing)", async () => {
    await clearSettings();
    await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300" });
    const sameAsFixed = await patch({ cwipAccountCode: "1200" });
    expect(sameAsFixed.statusCode).toBe(409);
    expect(JSON.parse(sameAsFixed.body).code).toBe("GL_HEAD_INVALID");
    expect(JSON.parse(sameAsFixed.body).message).toMatch(/capital work in progress and fixed asset accounts are both 1200/);
    const sameAsCwip = await patch({ rouAccountCode: "1300" });
    expect(sameAsCwip.statusCode).toBe(409);
    expect(JSON.parse(sameAsCwip.body).message).toMatch(/both 1300/);
    // two heads in ONE patch that clash with each other
    expect((await patch({ leaseOffsetAccountCode: "2390", leaseLiabilityAccountCode: "2390" })).statusCode).toBe(409);
    expect((await getSettings()).cwipAccountCode).toBe("1300"); // nothing stored by any refusal
    // distinct heads are fine, and re-sending an unchanged head is not a clash with itself
    expect((await patch({ cwipAccountCode: "1300", leaseOffsetAccountCode: "2390" })).statusCode).toBe(202);
  });

  it("a stale clash already in the table is caught before any capitalisation or lease", async () => {
    await clearSettings();
    await forceSettings({ cwipAccountCode: "1200", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300" });
    const id = randomUUID();
    await f3("auc_create", { id, projectCode: "CLASH-1", name: "Clash", amountMinor: 100, reason: "Sanctioned" });
    const res = await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize`, headers: auth(), payload: { reason: "Commissioned" } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("GL_HEAD_INVALID");
  });

  it("capitalisation needs the per-tenant fixed-asset head too (no 1200 default)", async () => {
    await clearSettings();
    await setSettings({ cwipAccountCode: "1300" });
    const id = randomUUID();
    await f3("auc_create", { id, projectCode: "NOFIXED-1", name: "No fixed", amountMinor: 100, reason: "Sanctioned" });
    const res = await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize`, headers: auth(), payload: { reason: "Commissioned" } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("ASSET_GL_NOT_CONFIGURED");
    expect(JSON.parse(res.body).message).toMatch(/fixed asset/);
  });

  it("the accumulated-depreciation account is the one FINANCE reports, whatever its code or name", async () => {
    resetFinanceCache();
    financeAccumDep = "1260"; // finance posts depreciation to 1260, which is called "Provision for wear"
    const calls0 = financeCalls.length;
    const res = await patch({ cwipAccountCode: "1260" });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/accumulated-depreciation/);
    const sys = financeCalls.slice(calls0).find((c) => c.url.endsWith("/v1/finance/accounts/system-heads"));
    expect(sys?.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": T1, "x-service-secret": TEST_SERVICE_SECRET });
    // an account named like it is refused even when finance's code differs
    const named = await patch({ cwipAccountCode: "1250" });
    expect(named.statusCode).toBe(409);
    expect(JSON.parse(named.body).message).toMatch(/accumulated-depreciation/);
    // 1300 is still fine
    expect((await patch({ cwipAccountCode: "1300" })).statusCode).toBe(202);
  });

  it("if finance cannot say what its accumulated-depreciation account is, validation fails closed (503) instead of guessing", async () => {
    resetFinanceCache();
    systemHeadsStatus = 500;
    const res = await patch({ cwipAccountCode: "1300" });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe("FINANCE_UNAVAILABLE");
    systemHeadsStatus = 200;
    financeAccumDep = "1250";
    resetFinanceCache();
  });
});

describe("impairment / revaluation heads: per-tenant, validated, no env defaults", () => {
  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: "/v1/assets/settings", headers: auth(), payload: { reason: "configure GL", ...payload } });
  const impair = (id: string) => app.inject({ method: "POST", url: `/v1/assets/assets/${id}/impairment`, headers: auth(), payload: { amountMinor: 300000, reason: "flood", eventDate: "2026-06-01" } });
  const reval = (id: string, newBookValueMinor: number) => app.inject({ method: "POST", url: `/v1/assets/assets/${id}/revaluation`, headers: auth(), payload: { newBookValueMinor, reason: "valuer report" } });
  const bookValue = async (id: string) => (await asTenant(T1, (tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, id))))[0]!.bookValue;
  const glOf = (type: string) => outboxFor(T1, "finance.gl.post", (p) => p.type === type);

  it("validates type (expense / equity), existence and clashes against the other heads", async () => {
    await clearSettings();
    await setSettings({ fixedAssetAccountCode: "1200", cwipAccountCode: "1300" });
    const wrongExpense = await patch({ impairmentExpenseAccountCode: "3100" }); // equity where an expense is needed
    expect(wrongExpense.statusCode).toBe(409);
    expect(JSON.parse(wrongExpense.body).message).toMatch(/impairment loss account 3100 has the wrong account type/);
    expect(JSON.parse((await patch({ impairmentExpenseAccountCode: "4100" })).body).message).toMatch(/wrong account type/); // income
    expect(JSON.parse((await patch({ revaluationReserveAccountCode: "5200" })).body).message).toMatch(/revaluation reserve account 5200 has the wrong account type/);
    expect(JSON.parse((await patch({ impairmentExpenseAccountCode: "9999" })).body).message).toMatch(/does not exist/);
    const clash = await patch({ impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "5200" });
    expect(clash.statusCode).toBe(409);
    expect(JSON.parse(clash.body).code).toBe("GL_HEAD_INVALID");
    expect((await getSettings()).impairmentExpenseAccountCode).toBeNull(); // nothing stored by any refusal
    const ok = await patch({ impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "3100" });
    expect(ok.statusCode).toBe(202);
    await setSettings({ impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "3100" });
    expect(await getSettings()).toMatchObject({ impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "3100" });
    // a clash with an already-stored head is caught too
    expect((await patch({ revaluationReserveAccountCode: "1200" })).statusCode).toBe(409);
  });

  it("impairment and revaluation answer 409 ASSET_GL_NOT_CONFIGURED until THEIR heads are set (no 5200 / 3100 defaults)", async () => {
    await clearSettings();
    const id = await seedAsset(T1, "IMPREV-1", { bookValue: 1_000_000n, acquisitionCost: 1_000_000n });
    await setSettings({ fixedAssetAccountCode: "1200" }); // the fixed-asset head alone is not enough
    const imp = await impair(id);
    expect(imp.statusCode).toBe(409);
    expect(JSON.parse(imp.body).code).toBe("ASSET_GL_NOT_CONFIGURED");
    expect(JSON.parse(imp.body).message).toMatch(/impairment loss/);
    const rev = await reval(id, 1_200_000);
    expect(rev.statusCode).toBe(409);
    expect(JSON.parse(rev.body).message).toMatch(/revaluation reserve/);
    expect(await bookValue(id)).toBe(1_000_000n);
  });

  it("with the heads set, the journals use the CONFIGURED accounts (not 5200 / 3100 by default)", async () => {
    await clearSettings();
    const id = await seedAsset(T1, "IMPREV-2", { bookValue: 1_000_000n, acquisitionCost: 1_000_000n });
    await setSettings({ fixedAssetAccountCode: "1200", impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "3100" });
    expect((await impair(id)).statusCode).toBe(202);
    // the consumer takes the heads from settings: change them and a new request posts to the new accounts
    await f3("impairment", { id: randomUUID(), assetId: id, amountMinor: 100000, bookValueBefore: "1000000", bookValueAfter: "900000", accumulatedDep: "0", reason: "x", eventDate: "2026-06-01" });
    const imps = await glOf("asset_impairment");
    const last = imps.at(-1)!.lines as Array<{ accountCode: string; debitMinor: string }>;
    expect(last.find((l) => BigInt(l.debitMinor) > 0n)!.accountCode).toBe("5200");
    expect(last.some((l) => l.accountCode === "1200")).toBe(true);
    await f3("revaluation", { id: randomUUID(), assetId: id, bookValueBefore: "900000", bookValueAfter: "1000000", delta: "100000", isUpward: true, accumulatedDep: "0", reason: "x", eventDate: "2026-06-01" });
    const revs = await glOf("asset_revaluation");
    expect((revs.at(-1)!.lines as Array<{ accountCode: string; creditMinor: string }>).find((l) => BigInt(l.creditMinor) > 0n)!.accountCode).toBe("3100");
  });

  it("the consumers REFUSE when a head has vanished: nothing is written and the book value does not change", async () => {
    await clearSettings();
    const id = await seedAsset(T1, "IMPREV-3", { bookValue: 1_000_000n, acquisitionCost: 1_000_000n });
    await setSettings({ fixedAssetAccountCode: "1200" }); // impairment / reserve heads missing
    const before = (await glOf("asset_impairment")).length;
    // (the queue swallows a handler's throw, so the proof is in the state: the whole transaction must have rolled back)
    const attempt = (op: string, payload: Record<string, unknown>) =>
      q.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: T1, actorId: MAKER, correlationId: "c", schemaVersion: "1.0",
        payload: { op, tenantId: T1, ...payload },
      });
    await attempt("impairment", { id: randomUUID(), assetId: id, amountMinor: 100000, bookValueBefore: "1000000", bookValueAfter: "900000", accumulatedDep: "0", reason: "x", eventDate: "2026-06-01" });
    await attempt("revaluation", { id: randomUUID(), assetId: id, bookValueBefore: "1000000", bookValueAfter: "1100000", delta: "100000", isUpward: true, accumulatedDep: "0", reason: "x", eventDate: "2026-06-01" });
    await wait(450);
    expect(await asTenant(T1, (tx) => tx.select().from(assetImpairments).where(eq(assetImpairments.assetId, id)))).toHaveLength(0); // no event row either
    expect(await bookValue(id)).toBe(1_000_000n); // the transaction rolled back with the missing head
    expect((await glOf("asset_impairment")).length).toBe(before);
  });
});

describe("GAP-ASSETS-PROJECTS-09: capitalisation is maker != checker, dated, posted (heads configured) and audited", () => {
  beforeAll(async () => { await clearSettings(); await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300", leaseOffsetAccountCode: "2390" }); });
  async function newAuc(code: string, amountMinor: number): Promise<string> {
    const id = randomUUID();
    await f3("auc_create", { id, projectCode: code, name: `Project ${code}`, amountMinor, reason: "Sanctioned" });
    return id;
  }
  const aucRow = async (id: string) => (await asTenant(T1, (tx) => tx.select().from(projectAuc).where(eq(projectAuc.id, id))))[0]!;
  const assetsFor = (code: string) => asTenant(T1, (tx) => tx.select().from(assetAssets).where(and(eq(assetAssets.tenantId, T1), eq(assetAssets.code, `AUC/${code}`))));
  const gl = (id: string) => outboxFor(T1, "finance.gl.post", (p) => p.voucherNo?.includes(id.slice(0, 8)) && p.type === "asset_capitalization");
  const depSchedules = (assetId: string) => outboxFor(T1, "asset.dep.schedule", (p) => p.assetId === assetId);
  const cap = (id: string, actor = MAKER, payload: Record<string, unknown> = { reason: "Commissioned" }) =>
    app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize`, headers: auth(T1, actor), payload });

  it("refuses (409 ASSET_GL_NOT_CONFIGURED) to request OR approve a capitalisation until the CWIP head is set", async () => {
    await clearSettings();
    const id = await newAuc("NOHEAD-1", 500000);
    const request = await cap(id);
    expect(request.statusCode).toBe(409);
    expect(JSON.parse(request.body).code).toBe("ASSET_GL_NOT_CONFIGURED");
    expect(JSON.parse(request.body).message).toMatch(/capital work in progress/);
    expect((await aucRow(id)).status).toBe("under_construction");

    await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200" });
    await f3("auc_capitalize_request", { aucId: id, capitalizationDate: "2026-06-15", reason: "Commissioned" });
    await setSettings({ cwipAccountCode: null }); // head removed after the request
    const approve = await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize/approve`, headers: auth(T1, CHECKER) });
    expect(approve.statusCode).toBe(409);
    expect(JSON.parse(approve.body).code).toBe("ASSET_GL_NOT_CONFIGURED");
    await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200" });
  });

  it("a head that finance no longer accepts blocks the approval (GL_HEAD_INVALID), and an unreachable finance is a 503", async () => {
    const id = await newAuc("BADHEAD-1", 500000);
    await f3("auc_capitalize_request", { aucId: id, capitalizationDate: "2026-06-15", reason: "Commissioned" });
    await forceSettings({ cwipAccountCode: "1250" }); // direct table write: simulates a stale/wrong value in the table
    const res = await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize/approve`, headers: auth(T1, CHECKER) });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("GL_HEAD_INVALID");
    await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200" });
    financeDown = true;
    expect((await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize/approve`, headers: auth(T1, CHECKER) })).statusCode).toBe(503);
    financeDown = false;
    expect((await aucRow(id)).status).toBe("pending_capitalization");
  });

  it("defaults to maker-checker: the capitalize route only requests, and needs a reason and a valid date", async () => {
    const id = await newAuc("MC-1", 500000);
    expect((await cap(id, MAKER, {})).statusCode).toBe(400);
    expect((await cap(id, MAKER, { reason: "Commissioned", capitalizationDate: "2999-01-01" })).statusCode).toBe(400);
    const ok = await cap(id);
    expect(ok.statusCode).toBe(202);
    expect(JSON.parse(ok.body).id).toBe(id);
  });

  it("request -> approve by a DIFFERENT approver: one asset, one Dr Fixed asset / Cr configured CWIP journal (pending), both depreciation schedules through the outbox, and audits", async () => {
    const id = await newAuc("MC-2", 500000);
    await f3("auc_capitalize_request", { aucId: id, capitalizationDate: "2026-06-15", reason: "Commissioned" });
    expect((await aucRow(id)).status).toBe("pending_capitalization");

    const self = await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize/approve`, headers: auth(T1, MAKER) });
    expect(self.statusCode).toBe(403);
    expect(JSON.parse(self.body).code).toBe("MAKER_CHECKER");
    await f3("auc_capitalize_approve", { aucId: id, assetId: randomUUID() }, T1, MAKER); // consumer-level: the maker cannot win
    expect((await aucRow(id)).status).toBe("pending_capitalization");
    expect(await assetsFor("MC-2")).toHaveLength(0);
    // ...and the refusal is recorded, not silent
    const lost = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === id && p.action === "capitalize_approve" && p.outcome === "failure");
    expect(lost).toHaveLength(1);
    expect(lost[0]!.details.failure).toBe("NOT_PENDING_OR_SAME_ACTOR");

    const assetId = randomUUID();
    expect((await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize/approve`, headers: auth(T1, CHECKER) })).statusCode).toBe(202);
    await f3("auc_capitalize_approve", { aucId: id, assetId }, T1, CHECKER);
    await f3("auc_capitalize_approve", { aucId: id, assetId: randomUUID() }, T1, CHECKER); // replay / racing second approval

    const row = await aucRow(id);
    expect(row).toMatchObject({ status: "capitalized", capDecidedBy: CHECKER, capRequestedBy: MAKER, glPostStatus: "pending" });
    expect(row.glJournalId).toBeTruthy();
    const assets = await assetsFor("MC-2");
    expect(assets).toHaveLength(1);
    expect(assets[0]!.id).toBe(assetId);
    expect(assets[0]!.acquisitionDate).toBe("2026-06-15");

    const journals = await gl(id);
    expect(journals).toHaveLength(1);
    expect(journals[0]!.id).toBe(row.glJournalId);
    expect(journals[0]!.lines).toEqual([
      { accountCode: "1200", debitMinor: "500000", creditMinor: "0" },
      { accountCode: "1300", debitMinor: "0", creditMinor: "500000" }, // the CONFIGURED head, never accumulated depreciation 1250
    ]);
    // schedules are outbox rows written in the SAME transaction: exactly two, one per book, at the capitalisation date
    const deps = await depSchedules(assetId);
    expect(deps.map((d) => [d.depBook, d.startDate]).sort()).toEqual([["company", "2026-06-15"], ["statutory", "2026-06-15"]]);
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === id && p.action === "capitalize");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.details).toMatchObject({ mode: "approved", requestedBy: MAKER, assetId, capitalizationDate: "2026-06-15", journal: "pending" });

    const again = await cap(id);
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).code).toBe("AUC_NOT_CAPITALIZABLE");
  });

  it("finance's answer flips gl_post_status: posted on finance.gl.posted, failed (with the reason and an audit) on finance.gl.rejected; replays change nothing", async () => {
    const mk = async (code: string) => {
      const id = await newAuc(code, 1000);
      await f3("auc_capitalize_request", { aucId: id, capitalizationDate: "2026-06-15", reason: "Commissioned" });
      await f3("auc_capitalize_approve", { aucId: id, assetId: randomUUID() }, T1, CHECKER);
      return aucRow(id);
    };
    const ok = await mk("GLOK-1");
    const bad = await mk("GLBAD-1");
    expect([ok.glPostStatus, bad.glPostStatus]).toEqual(["pending", "pending"]);
    await glEvent("finance.gl.posted", { journalId: ok.glJournalId, voucherNo: "CAP/x" });
    await glEvent("finance.gl.rejected", { journalId: bad.glJournalId, reason: "UNKNOWN_ACCOUNT_CODE: account 1300 is not in the chart of accounts" });
    await glEvent("finance.gl.posted", { journalId: bad.glJournalId }); // a late/replayed posted must not resurrect a failed journal
    await glEvent("finance.gl.rejected", { journalId: randomUUID() });  // someone else's journal: ignored
    expect(await aucRow(ok.id)).toMatchObject({ glPostStatus: "posted", glPostError: null });
    const failed = await aucRow(bad.id);
    expect(failed.glPostStatus).toBe("failed");
    expect(failed.glPostError).toMatch(/UNKNOWN_ACCOUNT_CODE/);
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === bad.id && p.action === "gl_post");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.outcome).toBe("failure");
    // the list API exposes the status for the UI
    const list = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/projects/auc", headers: auth() })).body).data as Array<{ id: string; glPostStatus: string }>;
    expect(list.find((r) => r.id === bad.id)?.glPostStatus).toBe("failed");
  });

  it("if the CWIP head vanished before the consumer ran, the project is capitalised but its journal is FAILED -- never posted to a guessed account", async () => {
    const id = await newAuc("NOCWIP-C", 700);
    await f3("auc_capitalize_request", { aucId: id, capitalizationDate: "2026-06-15", reason: "Commissioned" });
    await setSettings({ cwipAccountCode: null });
    await f3("auc_capitalize_approve", { aucId: id, assetId: randomUUID() }, T1, CHECKER);
    const row = await aucRow(id);
    expect(row.status).toBe("capitalized");
    expect(row.glPostStatus).toBe("failed");
    expect(row.glPostError).toMatch(/capital work in progress/);
    expect(await gl(id)).toHaveLength(0);
    await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200" });
  });

  it("only asset_admin / super_admin may approve or reject; a reject returns the project to under construction; a losing reject is audited", async () => {
    const id = await newAuc("MC-3", 100);
    await f3("auc_capitalize_request", { aucId: id, capitalizationDate: "2026-06-15", reason: "Commissioned" });
    expect((await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize/approve`, headers: auth(T1, CHECKER, ["asset_manager"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize/reject`, headers: auth(T1, CHECKER), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize/reject`, headers: auth(T1, CHECKER), payload: { reason: "Completion cert missing" } })).statusCode).toBe(202);
    await f3("auc_capitalize_reject", { aucId: id, reason: "Completion cert missing" }, T1, CHECKER);
    await f3("auc_capitalize_reject", { aucId: id, reason: "Completion cert missing" }, T1, CHECKER); // loser
    const row = await aucRow(id);
    expect(row.status).toBe("under_construction");
    expect(row.capRejectReason).toBe("Completion cert missing");
    expect(await assetsFor("MC-3")).toHaveLength(0);
    expect(await gl(id)).toHaveLength(0);
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === id && p.action === "capitalize_reject");
    expect(audits.map((a) => a.outcome).sort()).toEqual(["failure", "success"]);
  });

  it("switching maker-checker OFF needs a SECOND approver; ON stays single-actor; direct capitalisation is refused while it is ON", async () => {
    // a direct op published while maker-checker is ON is refused by the consumer (route checks too, the consumer is the authority)
    const early = await newAuc("DIR-0", 100);
    await f3("auc_capitalize", { aucId: early, assetId: randomUUID(), capitalizationDate: "2026-07-01", reason: "sneaky" });
    expect((await aucRow(early)).status).toBe("under_construction");
    const refused = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === early && p.outcome === "failure");
    expect(refused[0]!.details.failure).toBe("MAKER_CHECKER_REQUIRED");

    const patch = (actor: string, payload: Record<string, unknown>, roles?: string[]) =>
      app.inject({ method: "PATCH", url: "/v1/assets/settings", headers: auth(T1, actor, roles), payload });
    expect((await patch(MAKER, { capitalizeMakerChecker: false, reason: "Small unit" }, ["asset_manager"])).statusCode).toBe(403);
    const req = await patch(MAKER, { capitalizeMakerChecker: false, reason: "Small unit" });
    expect(req.statusCode).toBe(202);
    const requestId = JSON.parse(req.body).id as string;
    await f3("settings_request", { id: requestId, kind: "maker_checker_off", reason: "Small unit" });
    expect((await getSettings()).capitalizeMakerChecker).toBe(true); // NOT switched off by the request alone
    expect((await getSettings()).pendingMakerCheckerOff).toMatchObject({ id: requestId, requestedByMe: true });
    expect((await patch(MAKER, { capitalizeMakerChecker: false, reason: "Again" })).statusCode).toBe(409); // one pending request at a time

    const selfApprove = await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${requestId}/approve`, headers: auth(T1, MAKER) });
    expect(selfApprove.statusCode).toBe(403);
    expect(JSON.parse(selfApprove.body).code).toBe("MAKER_CHECKER");
    await f3("settings_request_approve", { id: requestId }, T1, MAKER); // consumer: the requester cannot win either
    expect((await getSettings()).capitalizeMakerChecker).toBe(true);
    const lostSelf = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === requestId && p.action === "maker_checker_off_approve" && p.outcome === "failure");
    expect(lostSelf).toHaveLength(1);

    const ok = await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${requestId}/approve`, headers: auth(T1, CHECKER) });
    expect(ok.statusCode).toBe(202);
    await f3("settings_request_approve", { id: requestId }, T1, CHECKER);
    await f3("settings_request_approve", { id: requestId }, T1, CHECKER); // loser: recorded
    expect((await getSettings()).capitalizeMakerChecker).toBe(false);
    expect((await getSettings()).pendingMakerCheckerOff).toBeNull();
    const approved = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === requestId && p.action === "maker_checker_off_approve");
    expect(approved.map((a) => a.outcome).sort()).toEqual(["failure", "failure", "success"]);
    expect(approved.find((a) => a.outcome === "success")!.details).toMatchObject({ requestedBy: MAKER, before: { capitalizeMakerChecker: true }, after: { capitalizeMakerChecker: false } });

    // direct mode now works: one asset, one journal (configured head), the double click is a recorded failure
    const id = await newAuc("DIR-1", 250000);
    const route = await cap(id, MAKER, { reason: "Commissioned", capitalizationDate: "2026-07-01" });
    expect(route.statusCode).toBe(202);
    const assetId = JSON.parse(route.body).id as string;
    expect(assetId).not.toBe(id);
    await f3("auc_capitalize", { aucId: id, assetId, capitalizationDate: "2026-07-01", reason: "Commissioned" });
    await f3("auc_capitalize", { aucId: id, assetId: randomUUID(), capitalizationDate: "2026-07-01", reason: "Commissioned" });
    expect(await assetsFor("DIR-1")).toHaveLength(1);
    expect((await depSchedules(assetId)).map((d) => d.startDate)).toEqual(["2026-07-01", "2026-07-01"]);
    const journals = await gl(id);
    expect(journals).toHaveLength(1);
    expect(journals[0]!.lines[1]).toEqual({ accountCode: "1300", debitMinor: "0", creditMinor: "250000" });
    const direct = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === id && p.action === "capitalize");
    expect(direct.map((a) => [a.outcome, a.details.mode ?? null]).sort()).toEqual([["failure", "direct"], ["success", "direct"]]);

    // turning it back ON is single-actor, audited with before/after; a reject path for a later OFF request
    expect((await patch(MAKER, { capitalizeMakerChecker: true, reason: "Back to two-person" })).statusCode).toBe(202);
    await setSettings({ capitalizeMakerChecker: true }, MAKER);
    expect((await getSettings()).capitalizeMakerChecker).toBe(true);
    const req2 = JSON.parse((await patch(MAKER, { capitalizeMakerChecker: false, reason: "Try again" })).body).id as string;
    await f3("settings_request", { id: req2, kind: "maker_checker_off", reason: "Try again" });
    const rej = await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${req2}/reject`, headers: auth(T1, CHECKER), payload: { reason: "Not justified" } });
    expect(rej.statusCode).toBe(202);
    await f3("settings_request_reject", { id: req2, reason: "Not justified" }, T1, CHECKER);
    expect((await getSettings()).capitalizeMakerChecker).toBe(true);
    expect((await getSettings()).pendingMakerCheckerOff).toBeNull();
    expect((await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${req2}/reject`, headers: auth(T1, CHECKER), payload: { reason: "Not justified" } })).statusCode).toBe(409);
  });
});

describe("GAP-ASSETS-LEASES-04/07: discounted liability, schedule, recognition journal (heads configured)", () => {
  const terms = { leaseNo: "L-12", lessorName: "Acme Realty", rouCostMinor: 12_000_000, leaseStart: "2026-04-01", leaseEnd: "2027-03-31", ibrBps: 800, paymentMinor: 1_000_000, paymentFrequency: "monthly" };
  const leaseRow = async (id: string) => (await asTenant(T1, (tx) => tx.select().from(assetLeases).where(eq(assetLeases.id, id))))[0]!;

  it("is refused (409 ASSET_GL_NOT_CONFIGURED) until the ROU and lease-liability heads are set, and the clearing head is needed when ROU differs from the liability", async () => {
    await clearSettings();
    const none = await app.inject({ method: "POST", url: "/v1/assets/leases", headers: auth(), payload: terms });
    expect(none.statusCode).toBe(409);
    expect(JSON.parse(none.body).code).toBe("ASSET_GL_NOT_CONFIGURED");
    expect(JSON.parse(none.body).message).toMatch(/right-of-use asset, lease liability/);
    await setSettings({ rouAccountCode: "1400", leaseLiabilityAccountCode: "2300" });
    const gap = await app.inject({ method: "POST", url: "/v1/assets/leases", headers: auth(), payload: terms });
    expect(gap.statusCode).toBe(409);
    expect(JSON.parse(gap.body).message).toMatch(/lease clearing/);
    // ROU == liability needs no clearing head
    const even = await app.inject({ method: "POST", url: "/v1/assets/leases", headers: auth(), payload: { leaseNo: "L-EVEN", lessorName: "X", rouCostMinor: 5_000_000, liabilityMinor: 5_000_000, leaseStart: "2026-04-01", leaseEnd: "2027-03-31" } });
    expect(even.statusCode).toBe(202);
    await setSettings({ leaseOffsetAccountCode: "2390" });
    // a head finance does not accept is a 409 GL_HEAD_INVALID at creation, too
    await forceSettings({ leaseLiabilityAccountCode: "1400" }); // asset type where a liability is required
    const bad = await app.inject({ method: "POST", url: "/v1/assets/leases", headers: auth(), payload: terms });
    expect(bad.statusCode).toBe(409);
    expect(JSON.parse(bad.body).code).toBe("GL_HEAD_INVALID");
    await setSettings({ leaseLiabilityAccountCode: "2300" });
  });

  it("preview returns the present value; a user-entered liability that disagrees is rejected; valid terms are accepted", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/assets/leases/preview", headers: auth(), payload: terms });
    expect(res.statusCode).toBe(200);
    const p = JSON.parse(res.body) as { liabilityMinor: string; totalInterestMinor: string; periods: number };
    expect(p.periods).toBe(12);
    expect(BigInt(p.liabilityMinor) + BigInt(p.totalInterestMinor)).toBe(12_000_000n);
    const bad = await app.inject({ method: "POST", url: "/v1/assets/leases", headers: auth(), payload: { ...terms, liabilityMinor: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body).code).toBe("LIABILITY_MISMATCH");
    expect((await app.inject({ method: "POST", url: "/v1/assets/leases", headers: auth(), payload: { ...terms, paymentMinor: undefined } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/assets/leases", headers: auth(), payload: { ...terms, ibrBps: undefined, paymentMinor: undefined } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/assets/leases", headers: auth(), payload: terms })).statusCode).toBe(202);
  });

  it("lease_create persists the schedule and emits one balanced journal on the CONFIGURED heads; the status follows finance's answer", async () => {
    const preview = JSON.parse((await app.inject({ method: "POST", url: "/v1/assets/leases/preview", headers: auth(), payload: terms })).body) as { liabilityMinor: string };
    const leaseId = randomUUID();
    await f3("lease_create", {
      leaseId, assetId: randomUUID(), leaseNo: "L-12", lessorName: "Acme Realty", rouCostMinor: 12_000_000, liabilityMinor: Number(preview.liabilityMinor),
      leaseStart: "2026-04-01", leaseEnd: "2027-03-31", ibrBps: 800, paymentMinor: 1_000_000, paymentFrequency: "monthly", code: "ROU/L-12", usefulLifeYears: 1,
    });
    const rows = await asTenant(T1, (tx) => tx.select().from(leaseScheduleRows).where(eq(leaseScheduleRows.leaseId, leaseId)));
    expect(rows).toHaveLength(12);
    const sorted = [...rows].sort((a, b) => a.seq - b.seq);
    expect(sorted[0]!.openingMinor).toBe(BigInt(preview.liabilityMinor));
    expect(sorted.at(-1)!.closingMinor).toBe(0n);
    expect(sorted.reduce((a, r) => a + r.principalMinor, 0n)).toBe(BigInt(preview.liabilityMinor));

    const lease = await leaseRow(leaseId);
    expect(lease).toMatchObject({ ibrBps: 800, paymentFrequency: "monthly", glPostStatus: "pending" });
    expect(lease.paymentMinor).toBe(1_000_000n);
    const journals = await outboxFor(T1, "finance.gl.post", (p) => p.type === "lease_recognition" && p.voucherNo.includes(leaseId.slice(0, 8)));
    expect(journals).toHaveLength(1);
    expect(journals[0]!.id).toBe(lease.glJournalId);
    const lines = journals[0]!.lines as Array<{ debitMinor: string; creditMinor: string; accountCode: string }>;
    expect(lines.reduce((a, l) => a + BigInt(l.debitMinor), 0n)).toBe(lines.reduce((a, l) => a + BigInt(l.creditMinor), 0n));
    expect(lines[0]).toEqual({ accountCode: "1400", debitMinor: "12000000", creditMinor: "0" }); // the dedicated ROU head, not 1200
    expect(lines[1]!.accountCode).toBe("2300");
    expect(lines[1]!.creditMinor).toBe(preview.liabilityMinor);
    expect(lines.find((l) => l.accountCode === "2390")).toBeTruthy(); // the ROU-vs-liability gap goes to the clearing head, not AP 2050
    expect(lines.some((l) => ["1200", "2050", "1250"].includes(l.accountCode))).toBe(false);

    await glEvent("finance.gl.rejected", { journalId: lease.glJournalId, reason: "UNKNOWN_ACCOUNT_CODE: account 2390 is not in the chart of accounts" });
    expect(await leaseRow(leaseId)).toMatchObject({ glPostStatus: "failed" });
    expect((await leaseRow(leaseId)).glPostError).toMatch(/UNKNOWN_ACCOUNT_CODE/);

    const sched = await app.inject({ method: "GET", url: `/v1/assets/leases/${leaseId}/schedule`, headers: auth() });
    expect(sched.statusCode).toBe(200);
    expect(JSON.parse(sched.body).data).toHaveLength(12);
    expect((await app.inject({ method: "GET", url: `/v1/assets/leases/${leaseId}/schedule`, headers: auth(T2) })).statusCode).toBe(404);
    const list = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/leases", headers: auth() })).body).data as Array<{ id: string; glPostStatus: string }>;
    expect(list.find((l) => l.id === leaseId)?.glPostStatus).toBe("failed");
  });

  it("a manual-liability lease posts Dr ROU / Cr liability / the gap to the clearing head, and is 'posted' once finance confirms", async () => {
    const leaseId = randomUUID();
    await f3("lease_create", {
      leaseId, assetId: randomUUID(), leaseNo: "L-MAN", lessorName: "Manual Lessor", rouCostMinor: 1_200_000, liabilityMinor: 1_150_000,
      leaseStart: "2026-04-01", leaseEnd: "2031-03-31", code: "ROU/L-MAN", usefulLifeYears: 5,
    });
    expect(await asTenant(T1, (tx) => tx.select().from(leaseScheduleRows).where(eq(leaseScheduleRows.leaseId, leaseId)))).toHaveLength(0);
    const journals = await outboxFor(T1, "finance.gl.post", (p) => p.type === "lease_recognition" && p.voucherNo.includes(leaseId.slice(0, 8)));
    const lines = journals[0]!.lines as Array<{ accountCode: string; debitMinor: string; creditMinor: string }>;
    expect(lines.reduce((a, l) => a + BigInt(l.debitMinor), 0n)).toBe(lines.reduce((a, l) => a + BigInt(l.creditMinor), 0n));
    expect(lines[2]).toEqual({ accountCode: "2390", debitMinor: "0", creditMinor: "50000" });
    await glEvent("finance.gl.posted", { journalId: (await leaseRow(leaseId)).glJournalId });
    expect((await leaseRow(leaseId)).glPostStatus).toBe("posted");
  });

  it("if the heads vanished before the consumer ran, the lease is recorded with its journal FAILED and no journal is posted", async () => {
    await setSettings({ rouAccountCode: null });
    const leaseId = randomUUID();
    await f3("lease_create", {
      leaseId, assetId: randomUUID(), leaseNo: "L-NOHEAD", lessorName: "X", rouCostMinor: 100_000, liabilityMinor: 100_000,
      leaseStart: "2026-04-01", leaseEnd: "2027-03-31", code: "ROU/L-NOHEAD", usefulLifeYears: 1,
    });
    const lease = await leaseRow(leaseId);
    expect(lease.glPostStatus).toBe("failed");
    expect(lease.glPostError).toMatch(/right-of-use asset/);
    expect(await outboxFor(T1, "finance.gl.post", (p) => p.voucherNo?.includes(leaseId.slice(0, 8)))).toHaveLength(0);
    await setSettings({ rouAccountCode: "1400" });
  });
});

describe("repost a failed journal (asset_admin only, heads re-validated, once)", () => {
  const aucRow = async (id: string) => (await asTenant(T1, (tx) => tx.select().from(projectAuc).where(eq(projectAuc.id, id))))[0]!;
  const leaseRow = async (id: string) => (await asTenant(T1, (tx) => tx.select().from(assetLeases).where(eq(assetLeases.id, id))))[0]!;
  const journalsOf = async (journalId: string) => (await asTenant(T1, (tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, T1), eq(outbox.topic, "finance.gl.post")))))
    .filter((r) => (r.payload as { id?: string }).id === journalId);
  const repostAuc = (id: string, actor = CHECKER, roles?: string[]) => app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/journal/repost`, headers: auth(T1, actor, roles) });
  const repostLease = (id: string, actor = CHECKER, roles?: string[]) => app.inject({ method: "POST", url: `/v1/assets/leases/${id}/journal/repost`, headers: auth(T1, actor, roles) });

  async function failedAuc(code: string) {
    await clearSettings();
    await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300", leaseOffsetAccountCode: "2390" });
    const id = randomUUID();
    await f3("auc_create", { id, projectCode: code, name: code, amountMinor: 500000, reason: "Sanctioned" });
    await f3("auc_capitalize_request", { aucId: id, capitalizationDate: "2026-06-15", reason: "Commissioned" });
    await f3("auc_capitalize_approve", { aucId: id, assetId: randomUUID() }, T1, CHECKER);
    const row = await aucRow(id);
    await glEvent("finance.gl.rejected", { journalId: row.glJournalId, reason: "UNKNOWN_ACCOUNT_CODE: account 1300 is not in the chart of accounts" });
    expect((await aucRow(id)).glPostStatus).toBe("failed");
    return aucRow(id);
  }

  it("AUC: re-validates the heads, flips failed -> pending once, re-enqueues the SAME journal under a fresh message id, and audits the flip", async () => {
    const auc = await failedAuc("RP-AUC-1");
    expect((await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${auc.id}/journal/repost`, headers: auth(T1, CHECKER, ["asset_manager"]) })).statusCode).toBe(403);
    expect((await repostAuc(randomUUID())).statusCode).toBe(404);
    const before = await journalsOf(auc.glJournalId!);
    expect(before).toHaveLength(1);

    expect((await repostAuc(auc.id)).statusCode).toBe(202);
    await f3("auc_journal_repost", { aucId: auc.id }, T1, CHECKER);
    await f3("auc_journal_repost", { aucId: auc.id }, T1, CHECKER); // double click: the second one finds it already pending
    const after = await aucRow(auc.id);
    expect(after).toMatchObject({ glPostStatus: "pending", glPostError: null, glJournalId: auc.glJournalId });
    const journals = await journalsOf(auc.glJournalId!);
    expect(journals).toHaveLength(2); // exactly ONE repost
    expect(new Set(journals.map((j) => j.id)).size).toBe(2); // fresh outbox message id for the repost
    expect(journals[1]!.payload).toEqual(journals[0]!.payload); // the same deterministic journal
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === auc.id && p.action === "journal_repost");
    expect(audits.map((a) => a.outcome).sort()).toEqual(["failure", "success"]);
    expect(audits.find((a) => a.outcome === "success")!.details).toMatchObject({ from: "failed", to: "pending", journalId: auc.glJournalId });
    expect(audits.find((a) => a.outcome === "failure")!.details.failure).toBe("NOT_FAILED");

    // finance answers the reposted journal: failed rows can be posted
    await glEvent("finance.gl.posted", { journalId: auc.glJournalId });
    expect((await aucRow(auc.id)).glPostStatus).toBe("posted");
    const notFailed = await repostAuc(auc.id);
    expect(notFailed.statusCode).toBe(409);
    expect(JSON.parse(notFailed.body).code).toBe("JOURNAL_NOT_FAILED");
  });

  it("AUC: the route re-validates the heads (409 until they are valid again) and the consumer refuses without them, leaving the row failed", async () => {
    const auc = await failedAuc("RP-AUC-2");
    await setSettings({ cwipAccountCode: null });
    const res = await repostAuc(auc.id);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("ASSET_GL_NOT_CONFIGURED");
    await f3("auc_journal_repost", { aucId: auc.id }, T1, CHECKER); // published anyway (e.g. setting cleared after the route check)
    expect((await aucRow(auc.id)).glPostStatus).toBe("failed");
    expect(await journalsOf(auc.glJournalId!)).toHaveLength(1);
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === auc.id && p.action === "journal_repost");
    expect(audits[0]).toMatchObject({ outcome: "failure", details: { failure: "ASSET_GL_NOT_CONFIGURED" } });
    // chart fixed again: the repost goes through
    await setSettings({ cwipAccountCode: "1300" });
    expect((await repostAuc(auc.id)).statusCode).toBe(202);
  });

  it("lease: same rules for the recognition journal", async () => {
    await clearSettings();
    await setSettings({ cwipAccountCode: "1300", fixedAssetAccountCode: "1200", rouAccountCode: "1400", leaseLiabilityAccountCode: "2300", leaseOffsetAccountCode: "2390" });
    const leaseId = randomUUID();
    await f3("lease_create", {
      leaseId, assetId: randomUUID(), leaseNo: "L-RP", lessorName: "Lessor", rouCostMinor: 1_200_000, liabilityMinor: 1_150_000,
      leaseStart: "2026-04-01", leaseEnd: "2031-03-31", code: "ROU/L-RP", usefulLifeYears: 5,
    });
    const lease = await leaseRow(leaseId);
    expect((await repostLease(leaseId)).statusCode).toBe(409); // still pending: not a failed journal
    await glEvent("finance.gl.rejected", { journalId: lease.glJournalId, reason: "UNKNOWN_ACCOUNT_CODE: account 2390 is not in the chart of accounts" });
    expect((await leaseRow(leaseId)).glPostStatus).toBe("failed");
    expect((await app.inject({ method: "POST", url: `/v1/assets/leases/${leaseId}/journal/repost`, headers: auth(T1, CHECKER, ["asset_manager"]) })).statusCode).toBe(403);
    expect((await repostLease(randomUUID())).statusCode).toBe(404);

    expect((await repostLease(leaseId)).statusCode).toBe(202);
    await f3("lease_journal_repost", { leaseId }, T1, CHECKER);
    await f3("lease_journal_repost", { leaseId }, T1, CHECKER);
    expect(await leaseRow(leaseId)).toMatchObject({ glPostStatus: "pending", glPostError: null });
    const journals = await journalsOf(lease.glJournalId!);
    expect(journals).toHaveLength(2);
    expect(new Set(journals.map((j) => j.id)).size).toBe(2);
    expect(journals[1]!.payload).toEqual(journals[0]!.payload);
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === leaseId && p.action === "journal_repost");
    expect(audits.map((a) => a.outcome).sort()).toEqual(["failure", "success"]);

    await glEvent("finance.gl.rejected", { journalId: lease.glJournalId, reason: "again" });
    await setSettings({ leaseOffsetAccountCode: null });
    const res = await repostLease(leaseId); // the gap needs the clearing head
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("ASSET_GL_NOT_CONFIGURED");
  });
});

describe("GAP-ASSETS-INSURANCE-CLAIMS-06: claim attachments are the caller's own, existing uploads", () => {
  const POLICY = randomUUID();
  const key = (tid: string, uploader: string, name = randomUUID()) => `uploads/${tid}/attachment/${uploader}/${name}.pdf`;
  const claim = (attachments: unknown, over: Record<string, unknown> = {}) => ({
    policyId: POLICY, assetId: randomUUID(), claimDate: "2026-09-01", claimAmountMinor: 1000, notes: "Line one\nLine two", attachments, ...over,
  });
  const post = (payload: unknown, actor = MAKER) => app.inject({ method: "POST", url: "/v1/assets/insurance/claims", headers: auth(T1, actor), payload: payload as never });
  beforeAll(async () => {
    await asTenant(T1, (tx) => tx.insert(assetPolicies).values({
      id: POLICY, tenantId: T1, assetId: randomUUID(), policyNo: "POL-ATT", insurer: "Insurer", coverageMinor: 1_000_000n, premiumMinor: 1000n,
      startDate: "2026-01-01", endDate: "2026-12-31", createdBy: MAKER, updatedBy: MAKER,
    }));
  });

  it("accepts the caller's own existing uploads; rejects another user's, another tenant's, a malformed key, a missing object, a 6th file, an oversize file and over-long notes", async () => {
    const absent = key(T1, MAKER);
    storageExists.mockImplementation(async (k: string) => k !== absent);
    const att = { key: key(T1, MAKER), fileName: "photo.pdf", size: 2048, mimeType: "application/pdf" };
    expect((await post(claim([att]))).statusCode).toBe(202);
    expect(storageExists).toHaveBeenCalledWith(att.key); // existence is verified (HEAD) on attach

    const others = await post(claim([{ ...att, key: key(T1, CHECKER) }]));
    expect(others.statusCode).toBe(400);
    expect(JSON.parse(others.body).code).toBe("INVALID_ATTACHMENT");
    const foreign = await post(claim([{ ...att, key: key(T2, MAKER) }]));
    expect(foreign.statusCode).toBe(400);
    expect(JSON.parse(foreign.body).code).toBe("INVALID_ATTACHMENT");
    expect((await post(claim([{ ...att, key: "../../etc/passwd" }]))).statusCode).toBe(400);
    expect((await post(claim([{ ...att, key: `uploads/${T1}/attachment/${randomUUID()}.pdf` }]))).statusCode).toBe(400); // the old layout (no uploader) is not accepted
    const missing = await post(claim([{ ...att, key: absent }]));
    expect(missing.statusCode).toBe(400);
    expect(JSON.parse(missing.body).code).toBe("ATTACHMENT_NOT_FOUND");
    expect((await post(claim(Array.from({ length: 6 }, () => ({ ...att, key: key(T1, MAKER) }))))).statusCode).toBe(400);
    expect((await post(claim([{ ...att, size: 50 * 1024 * 1024 }]))).statusCode).toBe(400);
    expect((await post(claim([], { notes: "x".repeat(1001) }))).statusCode).toBe(400);
  });

  it("a storage outage is a 503, not an accepted claim", async () => {
    storageExists.mockRejectedValueOnce(new Error("S3 unreachable"));
    const res = await post(claim([{ key: key(T1, MAKER), fileName: "a.pdf", size: 1, mimeType: "application/pdf" }]));
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe("STORAGE_UNAVAILABLE");
  });

  it("the consumer persists the attachments and multi-line notes with the claim", async () => {
    const id = randomUUID();
    const att = { key: key(T1, MAKER), fileName: "fir.pdf", size: 10, mimeType: "application/pdf" };
    await q.publish(COMMANDS.insuranceClaimCreate, {
      messageId: randomUUID(), type: COMMANDS.insuranceClaimCreate, tenantId: T1, actorId: MAKER, correlationId: "c", schemaVersion: "1.0",
      payload: { id, tenantId: T1, policyId: POLICY, assetId: randomUUID(), claimDate: "2026-09-01", claimAmountMinor: 1000, currency: "INR", notes: "Line one\nLine two", attachments: [att] },
    });
    await wait(500);
    const [row] = await asTenant(T1, (tx) => tx.select().from(assetClaims).where(eq(assetClaims.id, id)));
    expect(row!.attachments).toEqual([att]);
    expect(row!.notes).toBe("Line one\nLine two");
    const got = JSON.parse((await app.inject({ method: "GET", url: `/v1/assets/insurance/claims/${id}`, headers: auth() })).body) as { attachments: unknown[] };
    expect(got.attachments).toEqual([att]);
  });
});

describe("GAP-ASSETS-LIST-06: the list reports the total", () => {
  it("returns total across pages, honouring the same filters", async () => {
    for (const n of [1, 2, 3]) await seedAsset(T2, `TOT-${n}`, { assetType: "it" });
    const res = await app.inject({ method: "GET", url: "/v1/assets/assets?limit=2&offset=0&type=it", headers: auth(T2) });
    expect(res.statusCode).toBe(200);
    const b = JSON.parse(res.body) as { data: unknown[]; total: number; limit: number };
    expect(b.data).toHaveLength(2);
    expect(b.limit).toBe(2);
    expect(b.total).toBeGreaterThanOrEqual(3);
    const none = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/assets?type=vehicle", headers: auth(T2) })).body) as { total: number };
    expect(none.total).toBe(0);
    const alias = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/register?limit=1", headers: auth(T2) })).body) as { total: number };
    expect(alias.total).toBeGreaterThanOrEqual(3);
  });
});
