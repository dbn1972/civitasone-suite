/**
 * UAT DB test defects (asset-service, 2026-10-28) -- one regression test per defect.
 *
 *  1. POST /bulk/import 500: a BigInt in the queued rows broke JSON.stringify on the real bus.
 *  2. POST /assets/:id/meter-readings: accepted, never written (no consumer).
 *  3. Verification submit could never reach "submitted" (CHECK) / approve needs it.
 *  4. condemnation commands reused the entity id as messageId -> inbox dedupe dropped them.
 *  5. Water bill generate threw on fractional kilolitres (BigInt(30.5)).
 *  6. Route preflights: dispose / submit-approval without committee approval, auction on a pending recommendation.
 *  7. depreciation/schedule on an asset that already has a schedule: 409 instead of 202 + DLQ.
 *  8. Audit events for spare-parts and inter-org-transfer.
 *  9. `version` bumped by the update paths.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { outboxMessages as outbox } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";
import { assetAssets, assetCategories } from "../src/modules/register/schema.js";
import { assetMeterReadings, assetWorkOrders } from "../src/modules/maintenance/schema.js";
import { physicalVerifications, writeoffApprovals } from "../src/modules/verification/schema.js";
import { condemnationSurveys, condemnationRecommendations, assetAuctions } from "../src/modules/condemnation/schema.js";
import { pendingDisposals, assetDisposals } from "../src/modules/lifecycle/schema.js";
import { assetDepSchedules, assetDepEntries } from "../src/modules/depreciation/schema.js";
import { assetWaterBills, assetWaterServiceRequests } from "../src/modules/water-metering/schema.js";
import { assetWaterApplications, assetWaterConnections } from "../src/modules/water-connections/schema.js";
import { assetWaterTankerBookings } from "../src/modules/water-tanker/schema.js";
import { assetStreetlights, assetStreetlightFaults, assetStreetlightRequests } from "../src/modules/streetlight/schema.js";
import { assetPolicies } from "../src/modules/insurance/schema.js";
import { spareParts } from "../src/modules/enterprise/schema.js";
import { interOrgTransfers } from "../src/modules/enterprise/repo.js";
import { calculateBillAmount } from "../src/modules/water-metering/domain.js";
import { preflightCreateAuction } from "../src/modules/condemnation/preflight.js";
import * as streetlightRepo from "../src/modules/streetlight/repo.js";
import * as waterConnRepo from "../src/modules/water-connections/repo.js";
import * as waterMeterRepo from "../src/modules/water-metering/repo.js";
import * as waterTankerRepo from "../src/modules/water-tanker/repo.js";
import { registerF3EnterpriseConsumers } from "../src/modules/enterprise/f3-consumer.js";
import { registerMaintenanceConsumers } from "../src/modules/maintenance/consumer.js";
import { registerVerificationConsumers } from "../src/modules/verification/consumer.js";
import { registerCondemnationConsumers } from "../src/modules/condemnation/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { registerDepreciationConsumers } from "../src/modules/depreciation/consumer.js";
import { registerWaterMeteringConsumers } from "../src/modules/water-metering/consumer.js";
import { registerRegisterConsumers } from "../src/modules/register/consumer.js";
import { registerInsuranceConsumers } from "../src/modules/insurance/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-9a9a-4000-8000-0000000000d1";
const MAKER = "cccccccc-9a9a-4000-8000-0000000000c1";
const CHECKER = "cccccccc-9a9a-4000-8000-0000000000c2";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
const bearer = (actor = MAKER) => ({ authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles: ["asset_admin", "asset_manager"] }, SECRET, 3600)}` });

/** Poll until `fn` returns something truthy (the consumer is async). */
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for the consumer");
    await new Promise((r) => setTimeout(r, 60));
  }
}
const settle = (ms = 700) => new Promise<void>((r) => setTimeout(r, ms));

let app: FastifyInstance;
const categoryId = randomUUID();
let seq = 0;

const seedAsset = async (extra: Partial<typeof assetAssets.$inferInsert> = {}) => {
  const id = randomUUID();
  const code = `UATD-${Date.now().toString(36)}-${seq++}`;
  await asTenant((tx) => tx.insert(assetAssets).values({
    id, tenantId: TENANT, name: `UAT defects ${code}`, code, categoryId, status: "active", assetType: "fixed",
    acquisitionCost: 100000n, bookValue: 100000n, accumulatedDep: 0n, acquisitionDate: "2026-01-01",
    createdBy: MAKER, updatedBy: MAKER, ...extra,
  }));
  return id;
};
const getAsset = async (id: string) => (await asTenant((tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, id))))[0];
const audits = (needle: string) => asTenant(async (tx) =>
  (await tx.select().from(outbox).where(and(eq(outbox.tenantId, TENANT), eq(outbox.topic, "audit.event.record"))))
    .filter((r) => JSON.stringify(r.payload).includes(needle)));

beforeAll(async () => {
  registerF3EnterpriseConsumers(appQueue);
  registerMaintenanceConsumers(appQueue);
  registerVerificationConsumers(appQueue);
  registerCondemnationConsumers(appQueue);
  registerLifecycleConsumers(appQueue);
  registerDepreciationConsumers(appQueue);
  registerWaterMeteringConsumers(appQueue);
  registerRegisterConsumers(appQueue);
  registerInsuranceConsumers(appQueue);
  await appQueue.start();
  app = await buildApp();
  await app.ready();
  await asTenant((tx) => tx.insert(assetCategories).values({ id: categoryId, tenantId: TENANT, code: `UATD-${categoryId.slice(0, 8)}`, name: "uat-db-defects", createdBy: MAKER, updatedBy: MAKER }));
});

afterAll(async () => {
  // best effort: leave no rows behind that would collide with the next run
  const tables = [
    assetMeterReadings, assetWorkOrders, physicalVerifications, writeoffApprovals, condemnationSurveys,
    condemnationRecommendations, assetAuctions, pendingDisposals, assetDisposals, assetDepEntries, assetDepSchedules,
    assetWaterBills, assetWaterServiceRequests, assetWaterConnections, assetWaterApplications, assetWaterTankerBookings,
    assetStreetlights, assetStreetlightFaults, assetStreetlightRequests, assetPolicies, spareParts, interOrgTransfers,
    outbox, assetAssets,
  ] as const;
  for (const t of tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await asTenant((tx) => tx.delete(t as any).where(eq((t as any).tenantId, TENANT))).catch(() => undefined);
  }
  await asTenant((tx) => tx.delete(assetCategories).where(eq(assetCategories.id, categoryId))).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

// ───────────────────────────────────────────────────────────────────────────
describe("1. bulk import survives the queue's JSON serialisation", () => {
  it("publishes JSON-safe rows (money as exact strings) and the consumer persists the bigint columns", async () => {
    const spy = vi.spyOn(appQueue, "publish");
    const code = `UATD-BULK-${Date.now().toString(36)}`;
    const res = await app.inject({
      method: "POST", url: "/v1/assets/bulk/import", headers: bearer(),
      payload: { assets: [{ name: "Bulk chair", code, acquisitionCostMinor: 123456 }], reason: "uat defect 1" },
    });
    expect(res.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.f3RouteWrite);
    spy.mockRestore();
    expect(call).toBeTruthy();
    // The real SQS bus does JSON.stringify(message): a BigInt anywhere in the payload throws there.
    expect(() => JSON.stringify(call![1])).not.toThrow();
    const wire = JSON.parse(JSON.stringify(call![1])) as { payload: { rows: Array<Record<string, unknown>> } };
    expect(wire.payload.rows[0]).toMatchObject({ acquisitionCost: "123456", bookValue: "123456", salvageValue: "0", accumulatedDep: "0" });

    const row = await until(async () => (await asTenant((tx) => tx.select().from(assetAssets).where(eq(assetAssets.code, code))))[0]);
    expect(row.acquisitionCost).toBe(123456n);
    expect(row.bookValue).toBe(123456n);
    expect(row.salvageValue).toBe(0n);
    expect(row.accumulatedDep).toBe(0n);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("2. meter readings are consumed and written", () => {
  it("POST /assets/:id/meter-readings persists the reading and audits it", async () => {
    const assetId = await seedAsset();
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${assetId}/meter-readings`, headers: bearer(),
      payload: { meterType: "odometer", readingValue: 1234.5, unit: "km", readingDate: "2026-10-28", notes: "uat defect 2" },
    });
    expect(res.statusCode).toBe(202);
    const readingId = res.json().data?.id ?? res.json().id;
    const row = await until(async () => (await asTenant((tx) => tx.select().from(assetMeterReadings).where(eq(assetMeterReadings.assetId, assetId))))[0]);
    expect(row.id).toBe(readingId);
    expect(Number(row.readingValue)).toBe(1234.5);
    expect(row.meterType).toBe("odometer");
    expect(row.createdBy).toBe(MAKER);
    const a = await until(async () => { const r = await audits(readingId); return r.length ? r : null; });
    expect(a[0]!.payload).toMatchObject({ action: "record", resourceType: "meter_reading", outcome: "success" });
  });

  it("answers 404 for an asset that does not exist instead of a 202 that can never apply", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${randomUUID()}/meter-readings`, headers: bearer(),
      payload: { meterType: "hours_run", readingValue: 5, readingDate: "2026-10-28" },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("3. verification can reach submitted and then approved", () => {
  it("migration 0042 allows the real lifecycle values and drops the old constraint first", () => {
    const file = fileURLToPath(new URL("../migrations/0042_verification_status_lifecycle_check.sql", import.meta.url));
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/DROP CONSTRAINT IF EXISTS physical_verifications_status_check/);
    expect(text).toMatch(/CHECK \(status IN \('draft', 'in_progress', 'submitted', 'completed', 'approved'\)\)/);
  });

  it("the live CHECK allows 'submitted' (and keeps rejecting nonsense)", async () => {
    const rows = await sqlClient<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'lifecycle.physical_verifications'::regclass AND conname = 'physical_verifications_status_check'`;
    expect(rows[0]?.def).toContain("submitted");
    expect(rows[0]?.def).toContain("approved");
    expect(rows[0]?.def).not.toContain("bogus");
  });

  it("draft -> submit (202, row becomes submitted) -> approve by a second user (approved)", async () => {
    const id = randomUUID();
    await asTenant((tx) => tx.insert(physicalVerifications).values({
      id, tenantId: TENANT, verificationDate: "2026-10-28", verifiedBy: MAKER, status: "draft", createdBy: MAKER, updatedBy: MAKER,
    }));
    const submit = await app.inject({ method: "POST", url: `/v1/assets/verifications/${id}/submit`, headers: bearer() });
    expect(submit.statusCode).toBe(202);
    await until(async () => (await asTenant((tx) => tx.select().from(physicalVerifications).where(and(eq(physicalVerifications.id, id), eq(physicalVerifications.status, "submitted")))))[0]);

    const approve = await app.inject({ method: "POST", url: `/v1/assets/verifications/${id}/approve`, headers: bearer(CHECKER) });
    expect(approve.statusCode).toBe(202);
    const done = await until(async () => (await asTenant((tx) => tx.select().from(physicalVerifications).where(and(eq(physicalVerifications.id, id), eq(physicalVerifications.status, "approved")))))[0]);
    expect(done.approvedBy).toBe(CHECKER);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("4. condemnation commands are no longer dropped by the inbox dedupe", () => {
  const url = "/v1/assets";
  it("every command gets its own messageId (not the entity id)", async () => {
    const assetId = await seedAsset();
    const spy = vi.spyOn(appQueue, "publish");
    const created = await app.inject({
      method: "POST", url: `${url}/condemnation-surveys`, headers: bearer(),
      payload: { assetId, surveyDate: "2026-10-28", condition: "beyond_repair" },
    });
    expect(created.statusCode).toBe(202);
    const surveyId = created.json().data?.id ?? created.json().id;
    await until(async () => (await asTenant((tx) => tx.select().from(condemnationSurveys).where(eq(condemnationSurveys.id, surveyId))))[0]);
    const submit = await app.inject({
      method: "PATCH", url: `${url}/condemnation-surveys/${surveyId}/submit`, headers: bearer(),
      payload: { version: 1, recommendation: "condemn" },
    });
    expect(submit.statusCode).toBe(202);
    const sent = spy.mock.calls.filter((c) => String(c[0]).startsWith("asset.condemnation.survey")).map((c) => (c[1] as { messageId: string }).messageId);
    spy.mockRestore();
    expect(sent).toHaveLength(2);
    expect(new Set(sent).size).toBe(2);
    expect(sent).not.toContain(surveyId);
  });

  it("survey submit, recommendation approve, auction create and complete all persist end to end", async () => {
    const assetId = await seedAsset();
    const survey = await app.inject({ method: "POST", url: `${url}/condemnation-surveys`, headers: bearer(), payload: { assetId, surveyDate: "2026-10-28", condition: "unserviceable" } });
    const surveyId = survey.json().data?.id ?? survey.json().id;
    await until(async () => (await asTenant((tx) => tx.select().from(condemnationSurveys).where(eq(condemnationSurveys.id, surveyId))))[0]);

    expect((await app.inject({ method: "PATCH", url: `${url}/condemnation-surveys/${surveyId}/submit`, headers: bearer(), payload: { version: 1, recommendation: "condemn" } })).statusCode).toBe(202);
    const sub = await until(async () => (await asTenant((tx) => tx.select().from(condemnationSurveys).where(and(eq(condemnationSurveys.id, surveyId), eq(condemnationSurveys.status, "submitted")))))[0]);
    expect(sub.version).toBe(2);

    const rec = await app.inject({
      method: "POST", url: `${url}/condemnation-recommendations`, headers: bearer(),
      payload: { surveyId, assetId, committeeMembers: [{ name: "A", designation: "Chair" }, { name: "B", designation: "Member" }], decision: "condemn", reason: "beyond repair", reserveValueMinor: 100000 },
    });
    expect(rec.statusCode).toBe(202);
    const recId = rec.json().data?.id ?? rec.json().id;
    await until(async () => (await asTenant((tx) => tx.select().from(condemnationRecommendations).where(eq(condemnationRecommendations.id, recId))))[0]);

    // preflight 6c: an auction on a still-pending recommendation is a 409 now, not a 202 that vanishes
    const early = await app.inject({ method: "POST", url: `${url}/auctions`, headers: bearer(), payload: { assetId, recommendationId: recId, reserveValueMinor: 100000 } });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("RECOMMENDATION_NOT_APPROVED");

    expect((await app.inject({ method: "PATCH", url: `${url}/condemnation-recommendations/${recId}/approve`, headers: bearer(CHECKER), payload: { version: 1 } })).statusCode).toBe(202);
    await until(async () => (await asTenant((tx) => tx.select().from(condemnationRecommendations).where(and(eq(condemnationRecommendations.id, recId), eq(condemnationRecommendations.status, "approved")))))[0]);
    expect((await getAsset(assetId))!.status).toBe("condemned");

    const wrongAsset = await app.inject({ method: "POST", url: `${url}/auctions`, headers: bearer(), payload: { assetId: randomUUID(), recommendationId: recId, reserveValueMinor: 100000 } });
    expect(wrongAsset.statusCode).toBe(422);
    expect(wrongAsset.json().code).toBe("ASSET_MISMATCH");

    const auction = await app.inject({ method: "POST", url: `${url}/auctions`, headers: bearer(), payload: { assetId, recommendationId: recId, reserveValueMinor: 100000 } });
    expect(auction.statusCode).toBe(202);
    const auctionId = auction.json().data?.id ?? auction.json().id;
    await until(async () => (await asTenant((tx) => tx.select().from(assetAuctions).where(eq(assetAuctions.id, auctionId))))[0]);

    const dup = await app.inject({ method: "POST", url: `${url}/auctions`, headers: bearer(), payload: { assetId, recommendationId: recId, reserveValueMinor: 100000 } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("AUCTION_ALREADY_EXISTS");

    expect((await app.inject({
      method: "PATCH", url: `${url}/auctions/${auctionId}/complete`, headers: bearer(),
      payload: { version: 1, highestBidMinor: 150000, winnerName: "Winner", saleProceedsMinor: 150000 },
    })).statusCode).toBe(202);
    const done = await until(async () => (await asTenant((tx) => tx.select().from(assetAuctions).where(and(eq(assetAuctions.id, auctionId), eq(assetAuctions.status, "completed")))))[0]);
    expect(done.saleProceedsMinor).toBe(150000n);
    expect((await getAsset(assetId))!.status).toBe("disposed");
  });

  it("preflightCreateAuction maps each domain refusal to its HTTP status", () => {
    const ok = { status: "approved", decision: "condemn", assetId: "a" };
    expect(() => preflightCreateAuction(ok, 0, { assetId: "a" })).not.toThrow();
    expect(() => preflightCreateAuction(undefined, 0, { assetId: "a" })).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => preflightCreateAuction({ ...ok, status: "pending" }, 0, { assetId: "a" })).toThrow(expect.objectContaining({ status: 409, code: "RECOMMENDATION_NOT_APPROVED" }));
    expect(() => preflightCreateAuction({ ...ok, decision: "repair" }, 0, { assetId: "a" })).toThrow(expect.objectContaining({ status: 409, code: "RECOMMENDATION_NOT_CONDEMN" }));
    expect(() => preflightCreateAuction(ok, 0, { assetId: "b" })).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => preflightCreateAuction(ok, 1, { assetId: "a" })).toThrow(expect.objectContaining({ status: 409, code: "AUCTION_ALREADY_EXISTS" }));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("5. water bill: fractional kilolitres, integer paise", () => {
  it("calculateBillAmount: 30.5 kL x 5000 paise/kL = 152500; 18% tax truncated; total = amount + tax", () => {
    expect(calculateBillAmount(30.5, 5000n)).toEqual({ amountMinor: 152500n, taxMinor: 27450n, totalMinor: 179950n });
  });
  it("whole kilolitres give the same result as before", () => {
    expect(calculateBillAmount(42, 5000n)).toEqual({ amountMinor: 210000n, taxMinor: 37800n, totalMinor: 247800n });
    expect(calculateBillAmount(0, 5000n)).toEqual({ amountMinor: 0n, taxMinor: 0n, totalMinor: 0n });
  });
  it("rounds the amount half-up to a whole paisa and takes consumption at litre precision", () => {
    // 1.001 kL = 1001 L; 1001 * 5 / 1000 = 5.005 -> 5 ; 1.1 kL * 5 = 5.5 -> 6 (half-up)
    expect(calculateBillAmount(1.001, 5n).amountMinor).toBe(5n);
    expect(calculateBillAmount(1.1, 5n).amountMinor).toBe(6n);
    // below a litre is not a billing unit: 1.0004 kL is read as 1000 L
    expect(calculateBillAmount(1.0004, 1000n).amountMinor).toBe(1000n);
    // and float noise (0.1 + 0.2 = 0.30000000000000004 kL) does not leak into the paise
    expect(calculateBillAmount(0.1 + 0.2, 1000n).amountMinor).toBe(300n);
  });
  it("rejects negative or non-finite consumption and a negative rate", () => {
    expect(() => calculateBillAmount(-1, 5000n)).toThrow(RangeError);
    expect(() => calculateBillAmount(Number.NaN, 5000n)).toThrow(RangeError);
    expect(() => calculateBillAmount(1, -5n)).toThrow(RangeError);
  });

  it("POST /water/bills/generate with 30.5 kL persists a bill with exact integer paise", async () => {
    const connectionId = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/assets/water/bills/generate", headers: { authorization: `Bearer ${signToken({ sub: MAKER, tid: TENANT, roles: ["water_admin", "super_admin"] }, SECRET, 3600)}` },
      payload: { connectionId, readingId: randomUUID(), consumptionKl: 30.5, ratePerKl: 5000, billingPeriod: "2026-10", dueDate: "2026-11-05" },
    });
    expect(res.statusCode).toBe(202);
    const bill = await until(async () => (await asTenant((tx) => tx.select().from(assetWaterBills).where(eq(assetWaterBills.connectionId, connectionId))))[0]);
    expect(bill.amountMinor).toBe(152500n);
    expect(bill.taxMinor).toBe(27450n);
    expect(bill.totalMinor).toBe(179950n);
    expect(Number(bill.consumptionKl)).toBe(30.5);
  });

  it("a negative consumption is a 400 at the route", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/water/bills/generate", headers: { authorization: `Bearer ${signToken({ sub: MAKER, tid: TENANT, roles: ["water_admin", "super_admin"] }, SECRET, 3600)}` },
      payload: { connectionId: randomUUID(), readingId: randomUUID(), consumptionKl: -2, ratePerKl: 5000, billingPeriod: "2026-10", dueDate: "2026-11-05" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("6. route preflights answer 4xx for commands the consumer always rejects", () => {
  const dispose = { disposalDate: "2026-10-28", disposalMethod: "auction", proceedsMinor: 1000, currency: "INR" };
  const approveWriteoff = (assetId: string) => asTenant((tx) => tx.insert(writeoffApprovals).values({
    id: randomUUID(), tenantId: TENANT, assetId, requestedBy: MAKER, status: "approved", approvedBy: CHECKER,
  }));

  it("dispose and submit-approval: 404 for an unknown asset", async () => {
    const a = await app.inject({ method: "PATCH", url: `/v1/assets/assets/${randomUUID()}/dispose`, headers: bearer(), payload: dispose });
    expect(a.statusCode).toBe(404);
    const b = await app.inject({ method: "POST", url: `/v1/assets/disposals/${randomUUID()}/submit-approval`, headers: bearer(), payload: dispose });
    expect(b.statusCode).toBe(404);
  });

  it("dispose and submit-approval without committee approval: 409 COMMITTEE_APPROVAL_REQUIRED, nothing queued", async () => {
    const assetId = await seedAsset();
    const spy = vi.spyOn(appQueue, "publish");
    const a = await app.inject({ method: "PATCH", url: `/v1/assets/assets/${assetId}/dispose`, headers: bearer(), payload: dispose });
    expect(a.statusCode).toBe(409);
    expect(a.json().code).toBe("COMMITTEE_APPROVAL_REQUIRED");
    const b = await app.inject({ method: "POST", url: `/v1/assets/disposals/${assetId}/submit-approval`, headers: bearer(), payload: dispose });
    expect(b.statusCode).toBe(409);
    expect(b.json().code).toBe("COMMITTEE_APPROVAL_REQUIRED");
    expect(spy.mock.calls.filter((c) => c[0] === COMMANDS.assetDispose || c[0] === COMMANDS.disposalSubmitApproval)).toHaveLength(0);
    spy.mockRestore();
  });

  it("an already-disposed asset: 409 ASSET_ALREADY_DISPOSED", async () => {
    const assetId = await seedAsset({ status: "disposed" });
    await approveWriteoff(assetId);
    const res = await app.inject({ method: "PATCH", url: `/v1/assets/assets/${assetId}/dispose`, headers: bearer(), payload: dispose });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ASSET_ALREADY_DISPOSED");
  });

  it("with a committee-approved write-off, dispose is accepted and applied", async () => {
    const assetId = await seedAsset();
    await approveWriteoff(assetId);
    const res = await app.inject({ method: "PATCH", url: `/v1/assets/assets/${assetId}/dispose`, headers: bearer(), payload: dispose });
    expect(res.statusCode).toBe(202);
    await until(async () => (await asTenant((tx) => tx.select().from(assetDisposals).where(eq(assetDisposals.assetId, assetId))))[0]);
    expect((await getAsset(assetId))!.status).toBe("disposed");
  });

  it("submit-approval is accepted once, then 409 DISPOSAL_ALREADY_PENDING while it awaits the eOffice decision", async () => {
    const assetId = await seedAsset();
    await approveWriteoff(assetId);
    const first = await app.inject({ method: "POST", url: `/v1/assets/disposals/${assetId}/submit-approval`, headers: bearer(), payload: dispose });
    expect(first.statusCode).toBe(202);
    await until(async () => (await asTenant((tx) => tx.select().from(pendingDisposals).where(eq(pendingDisposals.assetId, assetId))))[0]);
    const second = await app.inject({ method: "POST", url: `/v1/assets/disposals/${assetId}/submit-approval`, headers: bearer(), payload: dispose });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("DISPOSAL_ALREADY_PENDING");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("7. depreciation/schedule on an asset that already has a schedule", () => {
  const body = { method: "SLM", startDate: "2026-04-01" };

  it("409 DEP_SCHEDULE_EXISTS and nothing is queued", async () => {
    const assetId = await seedAsset();
    await asTenant((tx) => tx.insert(assetDepSchedules).values({
      id: randomUUID(), tenantId: TENANT, assetId, method: "SLM", rate: "20", depBook: "company", usefulLifeYears: 5,
      startDate: "2026-04-01", endDate: "2031-04-01", originalCostMinor: 100000n, salvageMinor: 0n, currency: "INR", status: "active",
      createdBy: MAKER, updatedBy: MAKER,
    }));
    const spy = vi.spyOn(appQueue, "publish");
    const res = await app.inject({ method: "POST", url: `/v1/assets/assets/${assetId}/depreciation/schedule`, headers: bearer(), payload: body });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DEP_SCHEDULE_EXISTS");
    expect(spy.mock.calls.filter((c) => c[0] === COMMANDS.depSchedule)).toHaveLength(0);
    spy.mockRestore();
  });

  it("an asset with no schedule still gets one (202 and a persisted company schedule)", async () => {
    const assetId = await seedAsset();
    const res = await app.inject({ method: "POST", url: `/v1/assets/assets/${assetId}/depreciation/schedule`, headers: bearer(), payload: body });
    expect(res.statusCode).toBe(202);
    const s = await until(async () => (await asTenant((tx) => tx.select().from(assetDepSchedules).where(and(eq(assetDepSchedules.assetId, assetId), eq(assetDepSchedules.depBook, "company")))))[0]);
    expect(s.method).toBe("SLM");
    // and now a second request is the 409
    const again = await app.inject({ method: "POST", url: `/v1/assets/assets/${assetId}/depreciation/schedule`, headers: bearer(), payload: body });
    expect(again.statusCode).toBe(409);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("8. audit events for spare parts and inter-org transfers", () => {
  it("POST /work-orders/:id/spare-parts writes the part and an audit event", async () => {
    const workOrderId = randomUUID();
    const res = await app.inject({
      method: "POST", url: `/v1/assets/work-orders/${workOrderId}/spare-parts`, headers: bearer(),
      payload: { partCode: "UATD-PART-1", qty: 2, costMinor: 4500 },
    });
    expect(res.statusCode).toBe(202);
    const partId = res.json().data?.id ?? res.json().id;
    const part = await until(async () => (await asTenant((tx) => tx.select().from(spareParts).where(eq(spareParts.id, partId))))[0]);
    expect(part.costMinor).toBe(4500n);
    const a = await until(async () => { const r = await audits(partId); return r.length ? r : null; });
    expect(a).toHaveLength(1);
    expect(a[0]!.payload).toMatchObject({ action: "create", resourceType: "spare_part", resourceId: partId, outcome: "success" });
    expect(a[0]!.actorId).toBe(MAKER);
  });

  it("POST /assets/:id/inter-org-transfer writes the transfer and an audit event", async () => {
    const assetId = await seedAsset();
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${assetId}/inter-org-transfer`, headers: bearer(),
      payload: { fromOrg: "Ward 1", toOrg: "Ward 9", transferDate: "2026-10-28" },
    });
    expect(res.statusCode).toBe(202);
    const transferId = res.json().data?.id ?? res.json().id;
    await until(async () => (await asTenant((tx) => tx.select().from(interOrgTransfers).where(eq(interOrgTransfers.id, transferId))))[0]);
    const a = await until(async () => { const r = await audits(transferId); return r.length ? r : null; });
    expect(a).toHaveLength(1);
    expect(a[0]!.payload).toMatchObject({ action: "inter_org_transfer", resourceType: "asset", resourceId: assetId, outcome: "success" });
    expect(a[0]!.payload).toMatchObject({ details: { fromOrg: "Ward 1", toOrg: "Ward 9" } });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("9. update paths bump `version`", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bump = async (table: any, id: string) =>
    (await asTenant((tx) => tx.select({ v: table.version }).from(table).where(eq(table.id, id))))[0]!.v as number;

  it("PATCH /assets/:id/barcode", async () => {
    const assetId = await seedAsset();
    expect((await getAsset(assetId))!.version).toBe(1);
    const res = await app.inject({ method: "PATCH", url: `/v1/assets/assets/${assetId}/barcode`, headers: bearer(), payload: { barcode: `UATD-BC-${assetId.slice(0, 8)}` } });
    expect(res.statusCode).toBe(202);
    await until(async () => ((await getAsset(assetId))!.version === 2 ? true : null));
  });

  it("PATCH /work-orders/:id/complete", async () => {
    const assetId = await seedAsset();
    const id = randomUUID();
    await asTenant((tx) => tx.insert(assetWorkOrders).values({ id, tenantId: TENANT, assetId, scheduledDate: "2026-10-28", status: "open", createdBy: MAKER, updatedBy: MAKER }));
    const res = await app.inject({ method: "PATCH", url: `/v1/assets/work-orders/${id}/complete`, headers: bearer(), payload: { completedDate: "2026-10-28", costMinor: 1000 } });
    expect(res.statusCode).toBe(202);
    await until(async () => ((await bump(assetWorkOrders, id)) === 2 ? true : null));
  });

  it("PATCH /insurance/policies/:id", async () => {
    const assetId = await seedAsset();
    const id = randomUUID();
    await asTenant((tx) => tx.insert(assetPolicies).values({ id, tenantId: TENANT, assetId, policyNo: `P-${id.slice(0, 6)}`, insurer: "UAT Insurer", startDate: "2026-01-01", endDate: "2027-01-01", createdBy: MAKER, updatedBy: MAKER }));
    const res = await app.inject({ method: "PATCH", url: `/v1/assets/insurance/policies/${id}`, headers: bearer(), payload: { premiumMinor: 60000 } });
    expect(res.statusCode).toBe(202);
    await until(async () => ((await bump(assetPolicies, id)) === 2 ? true : null));
  });

  // The streetlight / water-connection / water-metering / water-tanker transitions all go through these helpers
  // (one per table), so exercising each helper covers every route that moves that table.
  it("streetlight, water application/connection, service request, bill and tanker transitions", async () => {
    const lightId = randomUUID(); const faultId = randomUUID(); const reqId = randomUUID();
    const appId = randomUUID(); const connId = randomUUID(); const srId = randomUUID(); const billId = randomUUID(); const bookingId = randomUUID();
    await asTenant(async (tx) => {
      await tx.insert(assetStreetlights).values({ id: lightId, tenantId: TENANT, poleId: `UATD-${lightId.slice(0, 8)}-x`, lampType: "led", wattage: 60, createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetStreetlightFaults).values({ id: faultId, tenantId: TENANT, streetlightId: lightId, faultNumber: `UATD-F-${faultId.slice(0, 8)}-x`, reportedBy: MAKER, faultType: "not_working", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetStreetlightRequests).values({ id: reqId, tenantId: TENANT, requestNumber: `UATD-R-${reqId.slice(0, 8)}-x`, requestedBy: MAKER, requestType: "new", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetWaterApplications).values({ id: appId, tenantId: TENANT, applicationNumber: `UATD-A-${appId.slice(0, 8)}-x`, applicantName: "UAT", applicantPhone: "9999999999", connectionType: "domestic", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetWaterConnections).values({ id: connId, tenantId: TENANT, connectionNumber: `UATD-C-${connId.slice(0, 8)}-x`, applicationId: appId, connectionType: "domestic", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetWaterServiceRequests).values({ id: srId, tenantId: TENANT, connectionId: connId, requestType: "leak", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetWaterBills).values({ id: billId, tenantId: TENANT, connectionId: connId, billNumber: `UATD-B-${billId.slice(0, 8)}-x`, consumptionKl: "10", ratePerKl: 5000n, amountMinor: 50000n, totalMinor: 59000n, dueDate: "2026-11-05", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetWaterTankerBookings).values({ id: bookingId, tenantId: TENANT, bookingNumber: `UATD-T-${bookingId.slice(0, 8)}-x`, requestedBy: MAKER, tankerCapacityLitres: 5000, requestedDate: "2026-10-30", createdBy: MAKER, updatedBy: MAKER });
    });
    await asTenant(async (tx) => {
      await streetlightRepo.updateStreetlightStatus(tx, lightId, TENANT, "faulty");
      await streetlightRepo.updateFaultStatus(tx, faultId, TENANT, "assigned");
      await streetlightRepo.updateRequestStatus(tx, reqId, TENANT, "surveyed");
      await waterConnRepo.updateApplicationStatus(tx, appId, TENANT, "submitted");
      await waterConnRepo.updateConnectionStatus(tx, connId, TENANT, "active");
      await waterMeterRepo.updateServiceRequestStatus(tx, srId, TENANT, "resolved");
      await waterMeterRepo.updateBillStatus(tx, billId, TENANT, "paid");
      await waterTankerRepo.updateBookingStatus(tx, bookingId, TENANT, "dispatched");
    });
    for (const [t, id] of [
      [assetStreetlights, lightId], [assetStreetlightFaults, faultId], [assetStreetlightRequests, reqId],
      [assetWaterApplications, appId], [assetWaterConnections, connId], [assetWaterServiceRequests, srId],
      [assetWaterBills, billId], [assetWaterTankerBookings, bookingId],
    ] as const) {
      expect(await bump(t, id)).toBe(2);
    }
    // a second transition bumps again (monotonic), it is not a one-off
    await asTenant((tx) => waterConnRepo.updateConnectionStatus(tx, connId, TENANT, "disconnected"));
    expect(await bump(assetWaterConnections, connId)).toBe(3);
  });
});
