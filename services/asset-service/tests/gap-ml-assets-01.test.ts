/**
 * ml-assets-01 gap batch -- asset-service.
 *
 * - GAP-ASSETS-BULK-IMPORT-03: duplicate asset codes are rejected up front (409
 *   DUPLICATE_CODE), within the file and against the register.
 * - GAP-ASSETS-BULK-IMPORT-04: Idempotency-Key makes a retried batch a no-op,
 *   and each batch emits exactly one audit event carrying actor, count, reason.
 * - GAP-ASSETS-CONDEMNATION-04: sale proceeds may not exceed the winning bid.
 * - GAP-ASSETS-DASHBOARD-03: paise on the dashboard are exact digit strings.
 * - GAP-ASSETS-FIXED-ASSETS-06: the register list has a stable order and pages.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages as outbox } from "../src/shared/outbox.js";
import { assetAssets, assetCategories } from "../src/modules/register/schema.js";
import { bulkImportBody, duplicateCodes, summariseCodes, parseIdempotencyKey } from "../src/modules/enterprise/bulk-import.js";
import { registerF3EnterpriseConsumers } from "../src/modules/enterprise/f3-consumer.js";
import { completeAuctionBody } from "../src/modules/condemnation/validators.js";
import { assertProceedsWithinBid } from "../src/modules/condemnation/domain.js";
import { condemnationSurveys, condemnationRecommendations, assetAuctions } from "../src/modules/condemnation/schema.js";
import { getDashboard } from "../src/modules/dashboard/queries.js";
import { listAssets } from "../src/modules/register/queries.js";
import { assetDepSchedules, assetDepEntries } from "../src/modules/depreciation/schema.js";
import { markEntryPosted } from "../src/modules/depreciation/repo.js";
import { registerDepreciationConsumers } from "../src/modules/depreciation/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-0000000000a7";
const ACTOR = "cccccccc-7777-4000-8000-0000000000c1";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
const tick = (ms = 500) => new Promise<void>((r) => setTimeout(r, ms));
const bearer = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["asset_admin"] }, SECRET, 3600)}` });

describe("pure guards", () => {
  it("duplicateCodes is case-insensitive and reports each repeated code once", () => {
    expect(duplicateCodes(["A/1", "B/2", "a/1", "A/1", "C"])).toEqual(["a/1"]);
    expect(duplicateCodes(["A", "B"])).toEqual([]);
  });

  it("summariseCodes truncates a long list", () => {
    expect(summariseCodes(["a", "b"])).toBe("a, b");
    expect(summariseCodes(Array.from({ length: 13 }, (_, i) => `C${i}`))).toBe("C0, C1, C2, C3, C4, C5, C6, C7, C8, C9 and 3 more");
  });

  it("parseIdempotencyKey accepts 8-128 printable chars only", () => {
    expect(parseIdempotencyKey("abcdef12")).toBe("abcdef12");
    expect(parseIdempotencyKey(["abcdef12", "x"])).toBe("abcdef12");
    expect(parseIdempotencyKey("short")).toBeUndefined();
    expect(parseIdempotencyKey("has space in it")).toBeUndefined();
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
  });

  it("bulkImportBody restricts assetType and keeps an optional reason", () => {
    const ok = bulkImportBody.parse({ assets: [{ name: "Chair", code: "F/1", acquisitionCostMinor: 100 }], reason: " load FY26 " });
    expect(ok.assets[0]!.assetType).toBe("fixed");
    expect(ok.reason).toBe("load FY26");
    expect(bulkImportBody.safeParse({ assets: [{ name: "Chair", code: "F/1", assetType: "gadget", acquisitionCostMinor: 100 }] }).success).toBe(false);
    expect(bulkImportBody.safeParse({ assets: [{ name: " ", code: "F/1", acquisitionCostMinor: 100 }] }).success).toBe(false);
    expect(bulkImportBody.safeParse({ assets: [{ name: "Chair", code: "F/1", acquisitionCostMinor: 100 }] }).success).toBe(false); // reason required
    expect(bulkImportBody.safeParse({ assets: [{ name: "Chair", code: "F/1", acquisitionCostMinor: 2 ** 53 }], reason: "x" }).success).toBe(false);
  });

  it("assertProceedsWithinBid is the consumer-side re-assertion", () => {
    expect(() => assertProceedsWithinBid(500001n, 500000n)).toThrow(/exceed the winning bid/);
    expect(() => assertProceedsWithinBid(500000n, 500000n)).not.toThrow();
  });

  it("completeAuctionBody rejects proceeds greater than the winning bid", () => {
    const base = { version: 1, highestBidMinor: 500000, winnerName: "W" };
    expect(completeAuctionBody.safeParse({ ...base, saleProceedsMinor: 500001 }).success).toBe(false);
    expect(completeAuctionBody.safeParse({ ...base, saleProceedsMinor: 500000 }).success).toBe(true);
    expect(completeAuctionBody.safeParse({ ...base, saleProceedsMinor: 1 }).success).toBe(true);
  });
});

describe("bulk import, dashboard and register paging (integration)", () => {
  let app: FastifyInstance;
  const categoryId = randomUUID();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await asTenant(async (tx) => {
      await tx.insert(assetCategories).values({ id: categoryId, tenantId: TENANT, code: "ML1", name: "ml-assets-01", createdBy: ACTOR, updatedBy: ACTOR });
    });
  });

  afterAll(async () => {
    await asTenant(async (tx) => {
      await tx.delete(outbox).where(eq(outbox.tenantId, TENANT));
      await tx.delete(assetAssets).where(eq(assetAssets.tenantId, TENANT));
      await tx.delete(assetCategories).where(eq(assetCategories.id, categoryId));
    });
    await app.close();
  });

  const seed = (code: string, bookValue: bigint, extra: Partial<typeof assetAssets.$inferInsert> = {}) =>
    asTenant((tx) => tx.insert(assetAssets).values({
      id: randomUUID(), tenantId: TENANT, name: `ML ${code}`, code, categoryId, status: "active", assetType: "fixed",
      acquisitionCost: bookValue, bookValue, accumulatedDep: 0n, acquisitionDate: "2026-01-01",
      createdBy: ACTOR, updatedBy: ACTOR, ...extra,
    }));
  const post = (assets: unknown[], headers: Record<string, string> = {}, reason: string | null = "ml test load") =>
    app.inject({ method: "POST", url: "/v1/assets/bulk/import", headers: { ...bearer(), ...headers }, payload: { assets, reason } });

  it("rejects a repeated code inside the file with 409 DUPLICATE_CODE", async () => {
    const res = await post([
      { name: "A", code: "ML-DUP-1", acquisitionCostMinor: 100 },
      { name: "B", code: "ml-dup-1", acquisitionCostMinor: 100 },
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
    expect(res.json().message).toMatch(/in the file/);
  });

  it("rejects a code that is already in the register with 409 DUPLICATE_CODE", async () => {
    await seed("ML-EXISTS-1", 1000n);
    const res = await post([{ name: "A", code: "ML-EXISTS-1", acquisitionCostMinor: 100 }, { name: "B", code: "ML-NEW-1", acquisitionCostMinor: 100 }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already in the register: ML-EXISTS-1/);
  });

  it("the same Idempotency-Key returns the same batch id; a different key a different one", async () => {
    const rows = [{ name: "A", code: "ML-IDEM-1", acquisitionCostMinor: 100 }];
    const a = await post(rows, { "x-idempotency-key": "key-ml-assets-0001" });
    const b = await post(rows, { "x-idempotency-key": "key-ml-assets-0001" });
    const c = await post(rows, { "x-idempotency-key": "key-ml-assets-0002" });
    expect(a.statusCode).toBe(202);
    expect(b.json().id).toBe(a.json().id);
    expect(c.json().id).not.toBe(a.json().id);
  });

  it("the unprefixed idempotency-key header still works as a fallback", async () => {
    const rows = [{ name: "A", code: "ML-FALL-1", acquisitionCostMinor: 100 }];
    const a = await post(rows, { "idempotency-key": "key-ml-fallback-1" });
    const b = await post(rows, { "idempotency-key": "key-ml-fallback-1" });
    expect(b.json().id).toBe(a.json().id);
  });

  it("a retry of an already-committed batch returns the original 202, not a duplicate-code 409", async () => {
    const q = new MemoryQueue();
    registerF3EnterpriseConsumers(q);
    await q.start();
    const key = `key-ml-retry-${randomUUID()}`; // fresh per run: _inbox.processed outlives the test rows
    const rows = [{ name: "Retry A", code: "ML-RETRY-1", acquisitionCostMinor: 500 }, { name: "Retry B", code: "ML-RETRY-2", acquisitionCostMinor: 700 }];
    const first = await post(rows, { "x-idempotency-key": key });
    expect(first.statusCode).toBe(202);
    // the real route published to the shared queue; deliver the same batch to the consumer here
    const batchId = first.json().id as string;
    const dbRows = rows.map((r) => ({
      id: randomUUID(), tenantId: TENANT, name: r.name, code: r.code, categoryId, assetType: "fixed", barcode: `BC-${r.code}`, status: "active",
      acquisitionCost: BigInt(r.acquisitionCostMinor), salvageValue: 0n, usefulLifeYears: 5, depRate: "20", depMethod: "SLM", currency: "INR",
      bookValue: BigInt(r.acquisitionCostMinor), accumulatedDep: 0n, acquisitionDate: "2026-01-01", poRef: null, grnRef: null, location: null,
      notes: `bulk:${batchId}`, orgUnit: null, createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await q.publish(COMMANDS.f3RouteWrite, {
      messageId: batchId, type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR, correlationId: "ml-retry", schemaVersion: "1.0",
      payload: { op: "bulk_import", id: batchId, tenantId: TENANT, rows: dbRows, reason: "retry test" },
    });
    await tick();
    await q.stop();
    const committed = await asTenant((tx) => tx.select().from(assetAssets).where(eq(assetAssets.notes, `bulk:${batchId}`)));
    expect(committed).toHaveLength(2);
    const retry = await post(rows, { "x-idempotency-key": key });
    expect(retry.statusCode).toBe(202);
    expect(retry.json().id).toBe(batchId);
    // without the key the same codes are now a genuine duplicate
    expect((await post(rows)).statusCode).toBe(409);
  });

  it("requires a reason and rejects a cost above 2^53 - 1", async () => {
    const rows = [{ name: "A", code: "ML-RSN-1", acquisitionCostMinor: 100 }];
    expect((await post(rows, {}, null)).statusCode).toBe(400);
    expect((await post([{ name: "A", code: "ML-RSN-2", acquisitionCostMinor: 9007199254740993 }])).statusCode).toBe(400);
  });

  it("delivering the same batch message twice inserts the assets once and audits once, with actor, count and reason", async () => {
    const q = new MemoryQueue();
    registerF3EnterpriseConsumers(q);
    await q.start();
    const batchId = randomUUID();
    const messageId = randomUUID();
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: randomUUID(), tenantId: TENANT, name: `Bulk ${i}`, code: `ML-BLK-${i}`, categoryId, assetType: "it",
      barcode: `BC-ML-BLK-${i}`, status: "active", acquisitionCost: 5000n, salvageValue: 0n, usefulLifeYears: 5, depRate: "20",
      depMethod: "SLM", currency: "INR", bookValue: 5000n, accumulatedDep: 0n, acquisitionDate: "2026-01-01",
      poRef: null, grnRef: null, location: null, notes: `bulk:${batchId}`, orgUnit: null, createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const msg = {
      messageId, type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR, correlationId: "ml-bulk", schemaVersion: "1.0",
      payload: { op: "bulk_import", id: batchId, tenantId: TENANT, rows, reason: "FY26 opening balance" },
    };
    await q.publish(COMMANDS.f3RouteWrite, msg);
    await q.publish(COMMANDS.f3RouteWrite, msg);
    await tick();
    await q.stop();

    const inserted = await asTenant((tx) => tx.select().from(assetAssets).where(eq(assetAssets.tenantId, TENANT)));
    expect(inserted.filter((r) => r.code.startsWith("ML-BLK-"))).toHaveLength(5);
    const audits = (await asTenant((tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, TENANT), eq(outbox.topic, "audit.event.record")))))
      .filter((r) => JSON.stringify(r.payload).includes(batchId));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(ACTOR);
    expect(audits[0]!.payload).toMatchObject({ action: "bulk_import", count: 5, reason: "FY26 opening balance" });
  });

  it("dashboard paise are exact digit strings, even above 2^53", async () => {
    await seed("ML-BIG-1", 9007199254740993n, { grnRef: "GRN-ML-1" });
    const d = await runWithTenant(TENANT, () => getDashboard(TENANT));
    expect(typeof d.netBlock).toBe("string");
    expect(BigInt(d.netBlock) >= 9007199254740993n).toBe(true);
    const recent = d.recentGrnAssets.find((r) => r.code === "ML-BIG-1");
    expect(recent?.acquisitionCost).toBe("9007199254740993");
  });

  it("the register lists in code order and offset pages do not overlap", async () => {
    for (const c of ["ML-ORD-C", "ML-ORD-A", "ML-ORD-B"]) await seed(c, 100n);
    const all = await runWithTenant(TENANT, () => listAssets(TENANT, { type: "fixed", limit: 200 }));
    const codes = all.map((r) => r.code);
    expect(codes).toEqual([...codes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const p1 = await runWithTenant(TENANT, () => listAssets(TENANT, { type: "fixed", limit: 2, offset: 0 }));
    const p2 = await runWithTenant(TENANT, () => listAssets(TENANT, { type: "fixed", limit: 2, offset: 2 }));
    expect(p1.map((r) => r.id).filter((id) => p2.some((r) => r.id === id))).toEqual([]);
  });
});

describe("condemnation commands are checked before they are queued (GAP-ASSETS-CONDEMNATION-08)", () => {
  let app: FastifyInstance;
  const MAKER = "cccccccc-7777-4000-8000-0000000000c2";
  const categoryId = randomUUID();
  const assetId = randomUUID();
  const surveyId = randomUUID();
  const recId = randomUUID();
  const auctionId = randomUUID();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await asTenant(async (tx) => {
      await tx.insert(assetCategories).values({ id: categoryId, tenantId: TENANT, code: "ML2", name: "ml-assets-01 c", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetAssets).values({
        id: assetId, tenantId: TENANT, name: "ML jeep", code: "ML-CND-1", categoryId, status: "active",
        acquisitionCost: 1000000n, bookValue: 400000n, accumulatedDep: 600000n, acquisitionDate: "2015-01-01", createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(condemnationSurveys).values({
        id: surveyId, tenantId: TENANT, assetId, surveyDate: "2026-07-01", surveyedBy: MAKER, condition: "beyond_repair",
        status: "draft", version: 2, createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(condemnationRecommendations).values({
        id: recId, tenantId: TENANT, surveyId, assetId, committeeMembers: [{ name: "A", designation: "B" }, { name: "C", designation: "D" }],
        decision: "condemn", reason: "test", reserveValueMinor: 300000n, status: "pending", version: 3, createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(assetAuctions).values({
        id: auctionId, tenantId: TENANT, assetId, recommendationId: recId, reserveValueMinor: 300000n, currency: "INR",
        status: "pending", version: 4, createdBy: MAKER, updatedBy: MAKER,
      });
    });
  });

  afterAll(async () => {
    await asTenant(async (tx) => {
      await tx.delete(assetAuctions).where(eq(assetAuctions.tenantId, TENANT));
      await tx.delete(condemnationRecommendations).where(eq(condemnationRecommendations.tenantId, TENANT));
      await tx.delete(condemnationSurveys).where(eq(condemnationSurveys.tenantId, TENANT));
      await tx.delete(assetAssets).where(eq(assetAssets.tenantId, TENANT));
      await tx.delete(assetCategories).where(eq(assetCategories.id, categoryId));
    });
    await app.close();
  });

  const as = (sub: string) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["asset_admin"] }, SECRET, 3600)}` });
  const approve = (sub: string, version: number) =>
    app.inject({ method: "PATCH", url: `/v1/assets/condemnation-recommendations/${recId}/approve`, headers: as(sub), payload: { version } });
  const complete = (payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: `/v1/assets/auctions/${auctionId}/complete`, headers: as(MAKER), payload: { winnerName: "W", ...payload } });

  it("403 when the approver is the creator of the recommendation", async () => {
    const res = await approve(MAKER, 3);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("409 STALE_VERSION when the version sent is not the current one", async () => {
    const res = await approve(ACTOR, 2);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("STALE_VERSION");
  });

  it("202 for a different approver on the current version", async () => {
    expect((await approve(ACTOR, 3)).statusCode).toBe(202);
  });

  it("survey submit: 409 on a stale version, 202 on the current one", async () => {
    const put = (version: number) => app.inject({
      method: "PATCH", url: `/v1/assets/condemnation-surveys/${surveyId}/submit`, headers: as(MAKER), payload: { version, recommendation: "condemn" },
    });
    expect((await put(1)).statusCode).toBe(409);
    expect((await put(2)).statusCode).toBe(202);
  });

  it("auction complete: 409 stale, 422 bid below reserve, 400 proceeds above bid, 202 when valid", async () => {
    expect((await complete({ version: 1, highestBidMinor: 400000, saleProceedsMinor: 400000 })).statusCode).toBe(409);
    const low = await complete({ version: 4, highestBidMinor: 299999, saleProceedsMinor: 299999 });
    expect(low.statusCode).toBe(422);
    expect(low.json().code).toBe("BID_BELOW_FLOOR");
    expect((await complete({ version: 4, highestBidMinor: 400000, saleProceedsMinor: 400001 })).statusCode).toBe(400);
    expect((await complete({ version: 4, highestBidMinor: 400000, saleProceedsMinor: 400000 })).statusCode).toBe(202);
  });
});

describe("a depreciation entry is posted to the GL once (GAP-ASSETS-DEPRECIATION-06)", () => {
  const categoryId = randomUUID();
  const assetId = randomUUID();
  const scheduleId = randomUUID();
  const entryId = randomUUID();

  beforeAll(async () => {
    await asTenant(async (tx) => {
      await tx.insert(assetCategories).values({ id: categoryId, tenantId: TENANT, code: "ML3", name: "ml-assets-01 d", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(assetAssets).values({
        id: assetId, tenantId: TENANT, name: "ML dep", code: "ML-DEP-1", categoryId, status: "active",
        acquisitionCost: 1200000n, bookValue: 1200000n, accumulatedDep: 0n, acquisitionDate: "2026-01-01", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(assetDepSchedules).values({
        id: scheduleId, tenantId: TENANT, assetId, method: "SLM", rate: "20", usefulLifeYears: 5, startDate: "2026-01-01", endDate: "2030-12-31",
        originalCostMinor: 1200000n, salvageMinor: 0n, depBook: "company", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(assetDepEntries).values({
        id: entryId, tenantId: TENANT, assetId, scheduleId, period: "2026-01", amountMinor: 20000n, bookValueAfterMinor: 1180000n,
        depBook: "company", createdBy: ACTOR, updatedBy: ACTOR,
      });
    });
  });

  afterAll(async () => {
    await asTenant(async (tx) => {
      await tx.delete(outbox).where(eq(outbox.tenantId, TENANT));
      await tx.delete(assetDepEntries).where(eq(assetDepEntries.tenantId, TENANT));
      await tx.delete(assetDepSchedules).where(eq(assetDepSchedules.tenantId, TENANT));
      await tx.delete(assetAssets).where(eq(assetAssets.tenantId, TENANT));
      await tx.delete(assetCategories).where(eq(assetCategories.id, categoryId));
    });
  });

  it("claiming an already-posted entry returns false (compare-and-set)", async () => {
    const first = await asTenant((tx) => markEntryPosted(tx, entryId, TENANT, "dep:test:1", ACTOR));
    const second = await asTenant((tx) => markEntryPosted(tx, entryId, TENANT, "dep:test:2", ACTOR));
    expect(first).toBe(true);
    expect(second).toBe(false);
    const row = (await asTenant((tx) => tx.select().from(assetDepEntries).where(eq(assetDepEntries.id, entryId))))[0]!;
    expect(row.glRef).toBe("dep:test:1");
    // reset for the consumer-level test below
    await asTenant((tx) => tx.update(assetDepEntries).set({ postedAt: null, glRef: null }).where(eq(assetDepEntries.id, entryId)));
  });

  it("two depRun commands for the same period (different message ids, run at once) post one GL journal and reduce the book value once", async () => {
    const mk = async () => { const q = new MemoryQueue(); registerDepreciationConsumers(q); await q.start(); return q; };
    const [q1, q2] = [await mk(), await mk()];
    const cmd = (messageId: string) => ({
      messageId, type: COMMANDS.depRun, tenantId: TENANT, actorId: ACTOR, correlationId: "ml-dep", schemaVersion: "1.0",
      payload: { tenantId: TENANT, period: "2026-01", depBook: "company" },
    });
    await Promise.all([q1.publish(COMMANDS.depRun, cmd(randomUUID())), q2.publish(COMMANDS.depRun, cmd(randomUUID()))]);
    await tick(1500);
    await Promise.all([q1.stop(), q2.stop()]);
    const gl = (await asTenant((tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, TENANT), eq(outbox.topic, "finance.gl.post")))))
      .filter((r) => JSON.stringify(r.payload).includes(assetId));
    expect(gl).toHaveLength(1);
    const asset = (await asTenant((tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, assetId))))[0]!;
    expect(asset.accumulatedDep).toBe(20000n);
  });
});

afterAll(async () => { await sqlClient.end(); });
