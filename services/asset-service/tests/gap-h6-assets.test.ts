/**
 * h6-assets gap batch — asset-service integrity fixes.
 *
 * - GAP-ASSETS-DETAIL-03: barcode tagging rejects markup characters.
 * - GAP-ASSETS-VERIFICATION-01: a verification session persists its location.
 * - GAP-ASSETS-CONDEMNATION-02/03 (consumer integrity, found while wiring the
 *   read models): a stale-version approval must not condemn the asset; an
 *   auction may only be opened on an approved "condemn" recommendation; a
 *   completed auction (or a stale version) must never retire the asset or post
 *   a second finance receipt / GL journal; the approver's reason is audited.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages as outbox } from "../src/shared/outbox.js";
import { tagBarcodeBody } from "../src/modules/register/validators.js";
import { assertValidStatus } from "../src/modules/register/domain.js";
import { approveRecommendationBody } from "../src/modules/condemnation/validators.js";
import { assertAuctionable, assertAuctionOpen, assertRecommendationPending, assertRowUpdated } from "../src/modules/condemnation/domain.js";
import { registerCondemnationConsumers } from "../src/modules/condemnation/consumer.js";
import { registerVerificationConsumers } from "../src/modules/verification/consumer.js";
import { condemnationSurveys, condemnationRecommendations, assetAuctions } from "../src/modules/condemnation/schema.js";
import { physicalVerifications } from "../src/modules/verification/schema.js";
import { assetAssets, assetCategories } from "../src/modules/register/schema.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-6666-4000-8000-0000000000a6";
const MAKER = "cccccccc-6666-4000-8000-0000000000c1";
const CHECKER = "cccccccc-6666-4000-8000-0000000000c2";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
const tick = (ms = 400) => new Promise<void>((r) => setTimeout(r, ms));

describe("pure guards", () => {
  it("tagBarcodeBody rejects markup / quotes / control chars and keeps normal codes", () => {
    expect(tagBarcodeBody.safeParse({ barcode: "<img src=x onerror=alert(1)>" }).success).toBe(false);
    expect(tagBarcodeBody.safeParse({ barcode: 'AST"1' }).success).toBe(false);
    expect(tagBarcodeBody.safeParse({ barcode: "AST\u00001" }).success).toBe(false);
    expect(tagBarcodeBody.safeParse({ barcode: "AST-2026-LAP/001" }).success).toBe(true);
  });

  it("'condemned' is a valid asset status in the register domain", () => {
    expect(() => assertValidStatus("condemned")).not.toThrow();
    expect(() => assertValidStatus("bogus")).toThrow();
  });

  it("approve body accepts an optional reason", () => {
    expect(approveRecommendationBody.parse({ version: 2, reason: "minutes 12" })).toEqual({ version: 2, reason: "minutes 12" });
    expect(approveRecommendationBody.parse({ version: 2 })).toEqual({ version: 2 });
  });

  it("condemnation domain guards", () => {
    expect(() => assertRowUpdated(0, "X")).toThrow();
    expect(() => assertRowUpdated(1, "X")).not.toThrow();
    expect(() => assertRecommendationPending("approved")).toThrow(/RECOMMENDATION_NOT_PENDING|not pending/);
    expect(() => assertAuctionOpen("completed")).toThrow(/not pending/);
    expect(() => assertAuctionable({ status: "pending", decision: "condemn", assetId: "a" }, "a")).toThrow(/not approved/);
    expect(() => assertAuctionable({ status: "approved", decision: "repair", assetId: "a" }, "a")).toThrow(/not condemn/);
    expect(() => assertAuctionable({ status: "approved", decision: "condemn", assetId: "a" }, "b")).toThrow(/differs/);
    expect(() => assertAuctionable(undefined, "a")).toThrow(/not found/);
    expect(() => assertAuctionable({ status: "approved", decision: "condemn", assetId: "a" }, "a")).not.toThrow();
  });
});

describe("asset-service consumers (integration)", () => {
  let app: FastifyInstance;
  const categoryId = randomUUID();
  const assetId = randomUUID();
  const surveyId = randomUUID();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await asTenant(async (tx) => {
      await tx.insert(assetCategories).values({ id: categoryId, tenantId: TENANT, code: "H6", name: "H6 test", createdBy: MAKER, updatedBy: MAKER });
      await tx.insert(assetAssets).values({
        id: assetId, tenantId: TENANT, name: "H6 jeep", code: `H6-${assetId.slice(0, 6)}`, categoryId, status: "active",
        acquisitionCost: 1000000n, bookValue: 400000n, accumulatedDep: 600000n, acquisitionDate: "2015-01-01",
        createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(condemnationSurveys).values({
        id: surveyId, tenantId: TENANT, assetId, surveyDate: "2026-07-01", surveyedBy: MAKER, condition: "beyond_repair",
        status: "submitted", recommendation: "condemn", createdBy: MAKER, updatedBy: MAKER,
      });
    });
  });

  afterAll(async () => {
    await asTenant(async (tx) => {
      await tx.delete(assetAuctions).where(eq(assetAuctions.tenantId, TENANT));
      await tx.delete(condemnationRecommendations).where(eq(condemnationRecommendations.tenantId, TENANT));
      await tx.delete(condemnationSurveys).where(eq(condemnationSurveys.tenantId, TENANT));
      await tx.delete(physicalVerifications).where(eq(physicalVerifications.tenantId, TENANT));
      await tx.delete(assetAssets).where(eq(assetAssets.tenantId, TENANT));
      await tx.delete(assetCategories).where(eq(assetCategories.id, categoryId));
    });
    await app.close();
    await sqlClient.end();
  });

  async function send(type: string, actorId: string, payload: Record<string, unknown>, register: (q: MemoryQueue) => void) {
    const q = new MemoryQueue();
    register(q);
    await q.start();
    await q.publish(type, {
      messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `h6-${type}`, schemaVersion: "1.0",
      payload: { tenantId: TENANT, ...payload },
    });
    await tick();
    await q.stop();
  }
  const condemn = (q: MemoryQueue) => registerCondemnationConsumers(q);

  async function seedRec(status: string, version = 1, decision = "condemn"): Promise<string> {
    const id = randomUUID();
    await asTenant((tx) => tx.insert(condemnationRecommendations).values({
      id, tenantId: TENANT, surveyId, assetId, committeeMembers: [{ name: "A", designation: "B" }, { name: "C", designation: "D" }],
      decision, reason: "test", reserveValueMinor: 300000n, floorValueMinor: 200000n, status, version,
      createdBy: MAKER, updatedBy: MAKER,
    }));
    return id;
  }
  const assetStatus = async (id = assetId) => (await asTenant((tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, id))))[0]!.status;
  const setAssetStatus = (status: string, id = assetId) =>
    asTenant((tx) => tx.update(assetAssets).set({ status }).where(eq(assetAssets.id, id)));
  const outboxFor = async (topic: string, needle: string) =>
    (await asTenant((tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, TENANT), eq(outbox.topic, topic)))))
      .filter((r) => JSON.stringify(r.payload).includes(needle));

  /** A fresh asset already condemned via an approved "condemn" recommendation. */
  async function condemnedAsset(): Promise<{ asset: string; rec: string }> {
    const asset = randomUUID();
    const survey = randomUUID();
    const rec = randomUUID();
    await asTenant(async (tx) => {
      await tx.insert(assetAssets).values({
        id: asset, tenantId: TENANT, name: "H6 truck", code: `H6-${asset.slice(0, 6)}`, categoryId, status: "condemned",
        acquisitionCost: 900000n, bookValue: 100000n, accumulatedDep: 800000n, acquisitionDate: "2012-01-01",
        createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(condemnationSurveys).values({
        id: survey, tenantId: TENANT, assetId: asset, surveyDate: "2026-07-01", surveyedBy: MAKER, condition: "beyond_repair",
        status: "submitted", recommendation: "condemn", createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(condemnationRecommendations).values({
        id: rec, tenantId: TENANT, surveyId: survey, assetId: asset, committeeMembers: [{ name: "A", designation: "B" }, { name: "C", designation: "D" }],
        decision: "condemn", reason: "test", reserveValueMinor: 300000n, status: "approved", version: 2, createdBy: MAKER, updatedBy: CHECKER,
      });
    });
    return { asset, rec };
  }

  it("a stale-version approval neither approves the recommendation nor condemns the asset", async () => {
    const recId = await seedRec("pending", 3);
    await send(COMMANDS.condemnationApprove, CHECKER, { id: recId, version: 1 }, condemn);
    const rec = (await asTenant((tx) => tx.select().from(condemnationRecommendations).where(eq(condemnationRecommendations.id, recId))))[0]!;
    expect(rec.status).toBe("pending");
    expect(await assetStatus()).toBe("active");
  });

  it("a current-version approval by a different user approves, condemns, and audits the reason", async () => {
    const recId = await seedRec("pending", 1);
    await send(COMMANDS.condemnationApprove, CHECKER, { id: recId, version: 1, reason: "Board minutes 7/2026" }, condemn);
    const rec = (await asTenant((tx) => tx.select().from(condemnationRecommendations).where(eq(condemnationRecommendations.id, recId))))[0]!;
    expect(rec.status).toBe("approved");
    expect(await assetStatus()).toBe("condemned");
    const audits = await asTenant((tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, TENANT), eq(outbox.topic, "audit.event.record"))));
    expect(audits.some((a) => JSON.stringify(a.payload).includes("Board minutes 7/2026"))).toBe(true);
  });

  it("refuses to open an auction on a pending recommendation (maker-checker bypass)", async () => {
    const recId = await seedRec("pending", 1);
    const auctionId = randomUUID();
    await send(COMMANDS.auctionCreate, MAKER, { id: auctionId, assetId, recommendationId: recId, reserveValueMinor: 300000, currency: "INR" }, condemn);
    const rows = await asTenant((tx) => tx.select().from(assetAuctions).where(eq(assetAuctions.id, auctionId)));
    expect(rows).toHaveLength(0);
  });

  it("completing an auction twice posts the finance receipt only once; a stale version posts nothing", async () => {
    await setAssetStatus("condemned");
    const recId = await seedRec("approved", 2);
    const auctionId = randomUUID();
    await send(COMMANDS.auctionCreate, MAKER, { id: auctionId, assetId, recommendationId: recId, reserveValueMinor: 300000, currency: "INR" }, condemn);
    expect(await asTenant((tx) => tx.select().from(assetAuctions).where(eq(assetAuctions.id, auctionId)))).toHaveLength(1);

    const receipts = async () =>
      (await asTenant((tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, TENANT), eq(outbox.topic, "finance.receipt.create")))))
        .filter((r) => JSON.stringify(r.payload).includes(auctionId));

    await send(COMMANDS.auctionComplete, MAKER, { id: auctionId, version: 9, highestBidMinor: 350000, winnerName: "Stale", saleProceedsMinor: 350000 }, condemn);
    expect(await receipts()).toHaveLength(0);

    await send(COMMANDS.auctionComplete, MAKER, { id: auctionId, version: 1, highestBidMinor: 350000, winnerName: "Winner", saleProceedsMinor: 350000 }, condemn);
    expect(await receipts()).toHaveLength(1);
    expect(await assetStatus()).toBe("disposed");

    // Replay with the NEW current version (2): must not post a second receipt.
    await send(COMMANDS.auctionComplete, MAKER, { id: auctionId, version: 2, highestBidMinor: 360000, winnerName: "Again", saleProceedsMinor: 360000 }, condemn);
    expect(await receipts()).toHaveLength(1);
  });

  it("persists the verification session location (POST → consumer → GET)", async () => {
    const tok = signToken({ sub: MAKER, tid: TENANT, roles: ["asset_admin"], sid: "s-h6" }, SECRET, 3600);
    const res = await app.inject({
      method: "POST", url: "/v1/assets/verifications",
      headers: { authorization: `Bearer ${tok}` },
      payload: { verificationDate: "2026-09-30", location: "Central Warehouse", notes: "Annual" },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json() as { id: string };
    await send(COMMANDS.verificationCreate, MAKER, { id, verificationDate: "2026-09-30", notes: "Annual", location: "Central Warehouse" }, (q) => registerVerificationConsumers(q));
    const row = (await asTenant((tx) => tx.select().from(physicalVerifications).where(eq(physicalVerifications.id, id))))[0];
    expect(row?.location).toBe("Central Warehouse");
    const list = await app.inject({ method: "GET", url: "/v1/assets/verifications", headers: { authorization: `Bearer ${tok}` } });
    expect(JSON.stringify(list.json())).toContain("Central Warehouse");
  });
  it("refuses a second auction on the same approved recommendation; only one receipt and one GL journal post", async () => {
    const { asset, rec } = await condemnedAsset();
    const a1 = randomUUID();
    const a2 = randomUUID();
    await send(COMMANDS.auctionCreate, MAKER, { id: a1, assetId: asset, recommendationId: rec, reserveValueMinor: 300000, currency: "INR" }, condemn);
    await send(COMMANDS.auctionCreate, MAKER, { id: a2, assetId: asset, recommendationId: rec, reserveValueMinor: 300000, currency: "INR" }, condemn);
    const auctions = await asTenant((tx) => tx.select().from(assetAuctions).where(eq(assetAuctions.recommendationId, rec)));
    expect(auctions.map((a) => a.id)).toEqual([a1]);

    await send(COMMANDS.auctionComplete, MAKER, { id: a1, version: 1, highestBidMinor: 310000, winnerName: "One", saleProceedsMinor: 310000 }, condemn);
    await send(COMMANDS.auctionComplete, MAKER, { id: a2, version: 1, highestBidMinor: 320000, winnerName: "Two", saleProceedsMinor: 320000 }, condemn);
    expect(await outboxFor("finance.receipt.create", asset)).toHaveLength(1);
    expect(await outboxFor("finance.gl.post", asset)).toHaveLength(1);
    expect(await assetStatus(asset)).toBe("disposed");
  });

  it("the unique index blocks a second active auction even if the consumer check is bypassed", async () => {
    const { asset, rec } = await condemnedAsset();
    const row = (id: string) => ({ id, tenantId: TENANT, assetId: asset, recommendationId: rec, reserveValueMinor: 1n, status: "pending", createdBy: MAKER, updatedBy: MAKER });
    await asTenant((tx) => tx.insert(assetAuctions).values(row(randomUUID())));
    await expect(asTenant((tx) => tx.insert(assetAuctions).values(row(randomUUID())))).rejects.toThrow();
  });

  it("does not retire (or post GL for) an asset that is no longer condemned", async () => {
    const { asset, rec } = await condemnedAsset();
    const auctionId = randomUUID();
    await send(COMMANDS.auctionCreate, MAKER, { id: auctionId, assetId: asset, recommendationId: rec, reserveValueMinor: 300000, currency: "INR" }, condemn);
    await setAssetStatus("disposed", asset); // disposed by another path meanwhile
    await send(COMMANDS.auctionComplete, MAKER, { id: auctionId, version: 1, highestBidMinor: 350000, winnerName: "Late", saleProceedsMinor: 350000 }, condemn);
    expect(await outboxFor("finance.receipt.create", asset)).toHaveLength(0);
    expect(await outboxFor("finance.gl.post", asset)).toHaveLength(0);
    const auction = (await asTenant((tx) => tx.select().from(assetAuctions).where(eq(assetAuctions.id, auctionId))))[0]!;
    expect(auction.status).toBe("pending"); // whole transaction rolled back
  });
});
