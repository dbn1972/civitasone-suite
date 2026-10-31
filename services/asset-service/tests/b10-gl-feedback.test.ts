/**
 * UAT bundle 10 (T6-01 / T6-02 / T6-14), real Postgres (NOBYPASSRLS app role):
 *  - F89: finance.gl.rejected for a DEPRECIATION journal puts the dep entry back to unposted and undoes the company-book
 *    move, so a re-run posts it (it used to stay "posted" with a lowered book value and no GL journal; re-run gave 409).
 *  - F90: an auction disposal is sent to finance in the asset_disposal shape (with gainLoss), not as
 *    "asset_disposal_auction", which finance has no branch for.
 *  - F97: a depreciation run skips entries of disposed / condemned / written-off assets.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages as outbox } from "../src/shared/outbox.js";
import { assetAssets, assetCategories } from "../src/modules/register/schema.js";
import { assetDepSchedules, assetDepEntries } from "../src/modules/depreciation/schema.js";
import { condemnationSurveys, condemnationRecommendations, assetAuctions } from "../src/modules/condemnation/schema.js";
import { registerDepreciationConsumers } from "../src/modules/depreciation/consumer.js";
import { registerF3EnterpriseConsumers } from "../src/modules/enterprise/f3-consumer.js";
import { registerCondemnationConsumers } from "../src/modules/condemnation/consumer.js";
import { summarizePeriod } from "../src/modules/depreciation/repo.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "aaaaaaaa-1010-4000-8000-0000000b1001";
const MAKER = "cccccccc-1010-4000-8000-0000000b1001";
const CHECKER = "cccccccc-1010-4000-8000-0000000b1002";
const PERIOD = "2026-09";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
const tick = (ms = 400) => new Promise<void>((r) => setTimeout(r, ms));
const categoryId = randomUUID();

async function send(type: string, actorId: string, payload: Record<string, unknown>, register: (q: MemoryQueue) => void): Promise<void> {
  const q = new MemoryQueue();
  register(q);
  await q.start();
  await q.publish(type, {
    messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `b10-${type}`, schemaVersion: "1.0",
    payload: { tenantId: TENANT, ...payload },
  });
  await tick();
  await q.stop();
}
const dep = (q: MemoryQueue) => registerDepreciationConsumers(q);
const f3 = (q: MemoryQueue) => registerF3EnterpriseConsumers(q);
const condemn = (q: MemoryQueue) => registerCondemnationConsumers(q);

const outboxFor = async (topic: string, needle: string) =>
  (await asTenant((tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, TENANT), eq(outbox.topic, topic)))))
    .filter((r) => JSON.stringify(r.payload).includes(needle));
const assetRow = async (id: string) => (await asTenant((tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, id))))[0]!;
const entryRow = async (id: string) => (await asTenant((tx) => tx.select().from(assetDepEntries).where(eq(assetDepEntries.id, id))))[0]!;

/** An asset (cost 1,200,000 paise, nothing depreciated yet) with one unposted company-book entry for PERIOD. */
async function assetWithDueEntry(status = "active", amount = 20_000n): Promise<{ asset: string; entry: string }> {
  const asset = randomUUID();
  const schedule = randomUUID();
  const entry = randomUUID();
  await asTenant(async (tx) => {
    await tx.insert(assetAssets).values({
      id: asset, tenantId: TENANT, name: "B10 asset", code: `B10-${asset.slice(0, 8)}`, categoryId, status,
      acquisitionCost: 1_200_000n, salvageValue: 0n, bookValue: 1_200_000n, accumulatedDep: 0n, acquisitionDate: "2026-01-01",
      createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(assetDepSchedules).values({
      id: schedule, tenantId: TENANT, assetId: asset, method: "SLM", rate: "20", usefulLifeYears: 5,
      startDate: "2026-01-01", endDate: "2031-01-01", originalCostMinor: 1_200_000n, salvageMinor: 0n, depBook: "company",
      createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(assetDepEntries).values({
      id: entry, tenantId: TENANT, assetId: asset, scheduleId: schedule, period: PERIOD, amountMinor: amount,
      bookValueAfterMinor: 1_200_000n - amount, depBook: "company", createdBy: MAKER, updatedBy: MAKER,
    });
  });
  return { asset, entry };
}

beforeAll(async () => {
  await asTenant((tx) => tx.insert(assetCategories).values({ id: categoryId, tenantId: TENANT, code: "B10", name: "B10 test", createdBy: MAKER, updatedBy: MAKER }));
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(assetAuctions).where(eq(assetAuctions.tenantId, TENANT));
    await tx.delete(condemnationRecommendations).where(eq(condemnationRecommendations.tenantId, TENANT));
    await tx.delete(condemnationSurveys).where(eq(condemnationSurveys.tenantId, TENANT));
    await tx.delete(assetDepEntries).where(eq(assetDepEntries.tenantId, TENANT));
    await tx.delete(assetDepSchedules).where(eq(assetDepSchedules.tenantId, TENANT));
    await tx.delete(assetAssets).where(eq(assetAssets.tenantId, TENANT));
    await tx.delete(assetCategories).where(eq(assetCategories.id, categoryId));
  });
  await sqlClient.end();
});

describe("F89: a refused depreciation journal is put back to unposted", () => {
  it("reverts the entry and the company-book move on finance.gl.rejected, so the period can be run again", async () => {
    const { asset, entry } = await assetWithDueEntry();
    await send(COMMANDS.depRun, MAKER, { period: PERIOD, depBook: "company" }, dep);

    const posted = await entryRow(entry);
    expect(posted.postedAt).not.toBeNull();
    const glRef = posted.glRef!;
    expect(glRef).toBe(`dep:company:${asset}:${PERIOD}`);
    expect(await assetRow(asset)).toMatchObject({ accumulatedDep: 20_000n, bookValue: 1_180_000n });
    const sent = (await outboxFor("finance.gl.post", asset))[0]!.payload as Record<string, unknown>;
    expect(sent).toMatchObject({ type: "depreciation", assetId: asset, period: PERIOD, depBook: "company" });

    // finance refuses it (the shape finance's depreciation branch now emits)
    const rejected = {
      journalId: randomUUID(), voucherNo: `DEP/company/${PERIOD}/${asset.slice(0, 8)}`, type: "depreciation",
      code: "UNKNOWN_ACCOUNT_CODE", reason: "UNKNOWN_ACCOUNT_CODE: account 1250 is not in the chart of accounts", accountCode: "1250",
      sourceRef: glRef, source: { kind: "depreciation", assetId: asset, period: PERIOD, depBook: "company", amountMinor: "20000" },
    };
    await send(CONSUMED_EVENTS.glRejected, MAKER, rejected, f3);

    const reverted = await entryRow(entry);
    expect(reverted.postedAt).toBeNull();
    expect(reverted.glRef).toBeNull();
    expect(await assetRow(asset)).toMatchObject({ accumulatedDep: 0n, bookValue: 1_200_000n });
    const audits = (await outboxFor("audit.event.record", entry)).map((r) => r.payload as Record<string, unknown>);
    expect(audits.some((a) => a.action === "dep_post" && a.outcome === "failure")).toBe(true);
    // the run page no longer reports the period as fully posted (the route's 409 ALREADY_POSTED)
    const books = await runWithTenant(TENANT, () => summarizePeriod(TENANT, PERIOD, "company"));
    expect(books.find((b) => b.depBook === "company")?.pendingCount).toBeGreaterThanOrEqual(1);

    // a replayed rejection changes nothing; the next run posts the entry again
    await send(CONSUMED_EVENTS.glRejected, MAKER, rejected, f3);
    expect(await assetRow(asset)).toMatchObject({ accumulatedDep: 0n, bookValue: 1_200_000n });
    await send(COMMANDS.depRun, MAKER, { period: PERIOD, depBook: "company" }, dep);
    expect((await entryRow(entry)).postedAt).not.toBeNull();
    expect(await assetRow(asset)).toMatchObject({ accumulatedDep: 20_000n, bookValue: 1_180_000n });
    expect(await outboxFor("finance.gl.post", asset)).toHaveLength(2); // same deterministic journal, re-sent once
  });
});

describe("F97: the depreciation run skips assets that left service", () => {
  it("does not post entries of disposed, condemned or written-off assets", async () => {
    const live = await assetWithDueEntry("active");
    const gone = await Promise.all(["disposed", "condemned", "written_off"].map((s) => assetWithDueEntry(s)));
    await send(COMMANDS.depRun, MAKER, { period: PERIOD, depBook: "company" }, dep);
    expect((await entryRow(live.entry)).postedAt).not.toBeNull();
    for (const g of gone) {
      expect((await entryRow(g.entry)).postedAt).toBeNull();
      expect(await outboxFor("finance.gl.post", g.asset)).toHaveLength(0);
      expect((await assetRow(g.asset)).accumulatedDep).toBe(0n);
    }
  });
});

describe("F90: an auction disposal is sent in finance's asset_disposal shape", () => {
  it("sends type asset_disposal with gainLoss = proceeds - (cost - accumulated dep), so the journal balances under a salvage clamp", async () => {
    const asset = randomUUID();
    const survey = randomUUID();
    const rec = randomUUID();
    await asTenant(async (tx) => {
      await tx.insert(assetAssets).values({
        id: asset, tenantId: TENANT, name: "B10 truck", code: `B10-${asset.slice(0, 8)}`, categoryId, status: "condemned",
        // salvage clamp: cost - accumulated = 50,000 but the headline bookValue is held at salvage (100,000)
        acquisitionCost: 900_000n, salvageValue: 100_000n, bookValue: 100_000n, accumulatedDep: 850_000n, acquisitionDate: "2012-01-01",
        createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(condemnationSurveys).values({
        id: survey, tenantId: TENANT, assetId: asset, surveyDate: "2026-07-01", surveyedBy: MAKER, condition: "beyond_repair",
        status: "submitted", recommendation: "condemn", createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(condemnationRecommendations).values({
        id: rec, tenantId: TENANT, surveyId: survey, assetId: asset, committeeMembers: [{ name: "A", designation: "B" }, { name: "C", designation: "D" }],
        decision: "condemn", reason: "test", reserveValueMinor: 300_000n, status: "approved", version: 2, createdBy: MAKER, updatedBy: CHECKER,
      });
    });
    const auctionId = randomUUID();
    await send(COMMANDS.auctionCreate, MAKER, { id: auctionId, assetId: asset, recommendationId: rec, reserveValueMinor: 300000, currency: "INR" }, condemn);
    await send(COMMANDS.auctionComplete, MAKER, { id: auctionId, version: 1, highestBidMinor: 350000, winnerName: "Winner", saleProceedsMinor: 350000 }, condemn);

    const gl = await outboxFor("finance.gl.post", asset);
    expect(gl).toHaveLength(1);
    expect(gl[0]!.payload).toMatchObject({
      type: "asset_disposal", assetId: asset, acquisitionCost: "900000", accumulatedDep: "850000",
      proceeds: "350000", gainLoss: "300000", currency: "INR",
    });
    // finance's journal: Dr accum 850000 + Dr cash 350000 = Cr cost 900000 + Cr gain 300000
    const p = gl[0]!.payload as Record<string, string>;
    expect(BigInt(p.accumulatedDep!) + BigInt(p.proceeds!)).toBe(BigInt(p.acquisitionCost!) + BigInt(p.gainLoss!));
  });
});
