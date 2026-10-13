/**
 * Follow-up to w0-report F5: plugin.marketplace.review was published with no
 * subscriber, so a review was accepted (202) and silently dropped. These tests run
 * the real wiring (route -> queue -> tenant-scoped consumer -> Postgres under FORCE
 * RLS): the review is stored once per reviewer, the listing rating is folded in
 * atomically, the audit row never carries the comment, a redelivery is a no-op, and
 * GET .../review reports the applied command so the web can show an honest state.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerMarketplaceConsumers } from "../src/modules/marketplace/consumer.js";
import { marketplaceListings, marketplaceReviews } from "../src/modules/marketplace/schema.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c9000000-0000-4000-8000-000000000f61";
const OTHER_TENANT = "c9000000-0000-4000-8000-000000000f62";
const ACTOR = "c9000000-0000-4000-8000-0000000000f6";
const ACTOR_2 = "c9000000-0000-4000-8000-0000000000f7";
const LISTING = "c9000000-0000-4000-8000-0000000000b1";
const INACTIVE = "c9000000-0000-4000-8000-0000000000b2";
const admin = signToken({ sub: ACTOR, tid: TENANT, roles: ["platform_admin"], sid: "s1" }, SECRET);
const otherAdmin = signToken({ sub: ACTOR, tid: OTHER_TENANT, roles: ["platform_admin"], sid: "s3" }, SECRET);
const viewer = signToken({ sub: ACTOR, tid: TENANT, roles: ["viewer"], sid: "s2" }, SECRET);
const COMMENT = "Works well with our GST filing setup";

function tenantScopedQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) => raw(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return queue;
}

function reviewMsg(over: { messageId?: string; tenantId?: string; actorId?: string; listingId?: string; rating?: number; comment?: string } = {}) {
  const messageId = over.messageId ?? randomUUID();
  const actorId = over.actorId ?? ACTOR;
  return {
    messageId, type: COMMANDS.marketplaceReview, tenantId: over.tenantId ?? TENANT, actorId, correlationId: "corr-rv", schemaVersion: "1.0",
    payload: { pluginId: over.listingId ?? LISTING, rating: over.rating ?? 4, comment: over.comment ?? COMMENT, reviewerId: actorId },
  };
}

const reviewsFor = (tenantId: string) => runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(marketplaceReviews).where(eq(marketplaceReviews.tenantId, tenantId))));
const outboxFor = (tenantId: string, topic: string) =>
  runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.topic, topic)))));
const listing = async () => (await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, LISTING)))[0]!;

async function wipe() {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(marketplaceReviews).where(eq(marketplaceReviews.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
  await db.update(marketplaceListings).set({ ratingSum: 0, ratingCount: 0, rating: null }).where(eq(marketplaceListings.id, LISTING));
}

describe("marketplace review: route -> consumer -> review row + rating + audit", () => {
  beforeAll(async () => {
    await db.insert(marketplaceListings).values([
      { id: LISTING, name: "GST Connector", version: "1.2.0", publisher: "NIC", category: "finance", isActive: true },
      { id: INACTIVE, name: "Retired", version: "0.1.0", publisher: "NIC", isActive: false },
    ]).onConflictDoNothing();
    await wipe();
  });
  afterAll(async () => {
    await wipe();
    await db.delete(marketplaceListings).where(eq(marketplaceListings.id, LISTING));
    await db.delete(marketplaceListings).where(eq(marketplaceListings.id, INACTIVE));
    await sqlClient.end();
  });

  it("route: 202 review_requested with a reviewId equal to the command messageId; validates rating, listing and role", async () => {
    const app = await buildApp();
    const spy = vi.spyOn(infraQueue, "publish").mockResolvedValue(undefined as never);
    const h = { authorization: `Bearer ${admin}` };
    const url = `/v1/plugins/marketplace/${LISTING}/review`;
    const ok = await app.inject({ method: "POST", url, headers: h, payload: { rating: 5, comment: COMMENT } });
    expect(ok.statusCode).toBe(202);
    const body = ok.json().data;
    expect(body.status).toBe("review_requested");
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.marketplaceReview)!;
    expect(call[1]).toMatchObject({ messageId: body.reviewId, tenantId: TENANT, payload: { pluginId: LISTING, rating: 5, reviewerId: ACTOR } });
    spy.mockClear();
    expect((await app.inject({ method: "POST", url, headers: h, payload: { rating: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers: h, payload: { rating: 6 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers: h, payload: { rating: 3.5 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/v1/plugins/marketplace/${randomUUID()}/review`, headers: h, payload: { rating: 4 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/plugins/marketplace/${INACTIVE}/review`, headers: h, payload: { rating: 4 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${viewer}` }, payload: { rating: 4 } })).statusCode).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    await app.close();
  });

  it("consumer: stores the review, updates the listing rating, audits without the comment; GET reports the applied reviewId", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    const app = await buildApp();
    const get = async () => (await app.inject({ method: "GET", url: `/v1/plugins/marketplace/${LISTING}/review`, headers: { authorization: `Bearer ${admin}` } })).json().data;
    expect(await get()).toBeNull();

    const msg = reviewMsg({ rating: 4 });
    await q.publish(COMMANDS.marketplaceReview, msg);
    await q.drain();

    const rows = await reviewsFor(TENANT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ listingId: LISTING, reviewerId: ACTOR, rating: 4, comment: COMMENT, messageId: msg.messageId });
    expect(await get()).toMatchObject({ reviewId: msg.messageId, rating: 4, comment: COMMENT });
    const l = await listing();
    expect(l).toMatchObject({ ratingSum: 4, ratingCount: 1 });
    expect(Number(l.rating)).toBe(4);
    const audit = (await outboxFor(TENANT, "audit.event.record")).filter((o) => (o.payload as { action?: string }).action === "marketplace.review");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toMatchObject({ outcome: "success", resourceId: LISTING, newValue: { rating: 4, hasComment: true, reviewId: msg.messageId } });
    expect(JSON.stringify(audit[0]!.payload)).not.toContain(COMMENT);
    await app.close();
  });

  it("redelivery of the same messageId is a no-op (no second row, rating bump or audit row)", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    const msg = reviewMsg({ rating: 5 });
    await q.publish(COMMANDS.marketplaceReview, msg);
    await q.drain();
    await q.publish(COMMANDS.marketplaceReview, msg);
    await q.drain();
    expect(await reviewsFor(TENANT)).toHaveLength(1);
    expect(await listing()).toMatchObject({ ratingSum: 5, ratingCount: 1 });
    expect(await outboxFor(TENANT, "audit.event.record")).toHaveLength(1);
  });

  it("the same reviewer reviewing again edits their review: still one row, count unchanged, sum adjusted by the delta", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    await q.publish(COMMANDS.marketplaceReview, reviewMsg({ rating: 5 }));
    await q.drain();
    const second = reviewMsg({ rating: 2, comment: "Regressed after the update" });
    await q.publish(COMMANDS.marketplaceReview, second);
    await q.drain();
    const rows = await reviewsFor(TENANT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 2, messageId: second.messageId, version: 2 });
    const l = await listing();
    expect(l).toMatchObject({ ratingSum: 2, ratingCount: 1 });
    expect(Number(l.rating)).toBe(2);
    const outcomes = (await outboxFor(TENANT, "audit.event.record")).map((o) => (o.payload as { outcome: string }).outcome);
    expect(outcomes).toEqual(["success", "success"]);
  });

  it("different reviewers and tenants average together; tenants cannot see each other's reviews", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    await q.publish(COMMANDS.marketplaceReview, reviewMsg({ rating: 5 }));
    await q.publish(COMMANDS.marketplaceReview, reviewMsg({ rating: 4, actorId: ACTOR_2 }));
    await q.publish(COMMANDS.marketplaceReview, reviewMsg({ rating: 3, tenantId: OTHER_TENANT }));
    await q.drain();
    expect(await reviewsFor(TENANT)).toHaveLength(2);
    expect(await reviewsFor(OTHER_TENANT)).toHaveLength(1);
    const l = await listing();
    expect(l).toMatchObject({ ratingSum: 12, ratingCount: 3 });
    expect(Number(l.rating)).toBe(4);
    const app = await buildApp();
    const mine = (await app.inject({ method: "GET", url: `/v1/plugins/marketplace/${LISTING}/review`, headers: { authorization: `Bearer ${otherAdmin}` } })).json().data;
    expect(mine).toMatchObject({ rating: 3 });
    await app.close();
  });

  it("an unavailable listing stores nothing and is audited as a failure and acked", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    await q.publish(COMMANDS.marketplaceReview, reviewMsg({ listingId: INACTIVE }));
    await q.drain();
    expect(await reviewsFor(TENANT)).toHaveLength(0);
    const audit = await outboxFor(TENANT, "audit.event.record");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toMatchObject({ outcome: "failure", newValue: { detail: "LISTING_UNAVAILABLE" } });
  });

  it("an out-of-range rating that bypassed the route is refused by the consumer (audited failure, nothing written)", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    await q.publish(COMMANDS.marketplaceReview, reviewMsg({ rating: 9 }));
    await q.drain();
    expect(await reviewsFor(TENANT)).toHaveLength(0);
    expect((await listing()).ratingCount).toBe(0);
    expect((await outboxFor(TENANT, "audit.event.record"))[0]!.payload).toMatchObject({ outcome: "failure", newValue: { detail: "INVALID_RATING" } });
  });
});
