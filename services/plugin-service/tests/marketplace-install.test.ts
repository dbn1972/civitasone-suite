/**
 * w0-report (F5) defect 1: POST /v1/plugins/marketplace/:id/install published
 * plugin.marketplace.install but nothing subscribed, so the web showed a false
 * "installed". These tests run the real wiring (route -> queue -> tenant-scoped
 * consumer -> Postgres under FORCE RLS): publish, consume, plugin installed,
 * audit row (with the operator's reason), and a redelivery is a no-op.
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
import { marketplaceListings } from "../src/modules/marketplace/schema.js";
import { plugins } from "../src/modules/registry/schema.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c9000000-0000-4000-8000-000000000f51";
const OTHER_TENANT = "c9000000-0000-4000-8000-000000000f52";
const ACTOR = "c9000000-0000-4000-8000-0000000000f5";
const LISTING = "c9000000-0000-4000-8000-0000000000a1";
const INACTIVE = "c9000000-0000-4000-8000-0000000000a2";
const admin = signToken({ sub: ACTOR, tid: TENANT, roles: ["platform_admin"], sid: "s1" }, SECRET);
const viewer = signToken({ sub: ACTOR, tid: TENANT, roles: ["viewer"], sid: "s2" }, SECRET);
const REASON = "Needed for the Q3 GST filing rollout";

function tenantScopedQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) => raw(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return queue;
}

function installMsg(over: { messageId?: string; tenantId?: string; listingId?: string; reason?: string } = {}) {
  const installId = over.messageId ?? randomUUID();
  const tenantId = over.tenantId ?? TENANT;
  return {
    messageId: installId, type: COMMANDS.marketplaceInstall, tenantId, actorId: ACTOR, correlationId: "corr-f5", schemaVersion: "1.0",
    payload: { installId, pluginId: over.listingId ?? LISTING, tenantId, reason: over.reason ?? REASON },
  };
}

const pluginsFor = (tenantId: string) => runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(plugins).where(eq(plugins.tenantId, tenantId))));
const outboxFor = (tenantId: string, topic: string) =>
  runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.topic, topic)))));
const installs = async () => (await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, LISTING)))[0]!.installs;

async function wipe() {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(plugins).where(eq(plugins.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
}

describe("marketplace install: route -> consumer -> registry + audit (w0-report F5)", () => {
  beforeAll(async () => {
    await db.insert(marketplaceListings).values([
      { id: LISTING, name: "GST Connector", version: "1.2.0", publisher: "NIC", description: "GST", category: "finance", isActive: true },
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

  it("route: 202 install_requested, publishes plugin.marketplace.install carrying the reason; messageId == installId", async () => {
    const app = await buildApp();
    const spy = vi.spyOn(infraQueue, "publish").mockResolvedValue(undefined as never);
    const r = await app.inject({ method: "POST", url: `/v1/plugins/marketplace/${LISTING}/install`, headers: { authorization: `Bearer ${admin}` }, payload: { reason: REASON } });
    expect(r.statusCode).toBe(202);
    const body = r.json().data;
    expect(body.status).toBe("install_requested");
    const call = spy.mock.calls.find((c) => c[0] === "plugin.marketplace.install")!;
    expect(call).toBeTruthy();
    expect(call[1]).toMatchObject({ messageId: body.installId, tenantId: TENANT, payload: { installId: body.installId, pluginId: LISTING, reason: REASON } });
    spy.mockRestore();
    await app.close();
  });

  it("route: reason is required (400), listing must exist (404), role-gated (403)", async () => {
    const app = await buildApp();
    const spy = vi.spyOn(infraQueue, "publish").mockResolvedValue(undefined as never);
    const h = { authorization: `Bearer ${admin}` };
    expect((await app.inject({ method: "POST", url: `/v1/plugins/marketplace/${LISTING}/install`, headers: h })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/v1/plugins/marketplace/${LISTING}/install`, headers: h, payload: { reason: "  " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/v1/plugins/marketplace/${randomUUID()}/install`, headers: h, payload: { reason: REASON } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/plugins/marketplace/${INACTIVE}/install`, headers: h, payload: { reason: REASON } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/plugins/marketplace/${LISTING}/install`, headers: { authorization: `Bearer ${viewer}` }, payload: { reason: REASON } })).statusCode).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    await app.close();
  });

  it("consumer: installs the plugin (registry row, state installed), emits installed event + audit row with the reason, status flips to installed", async () => {
    const before = await installs();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    const msg = installMsg();
    const app = await buildApp();
    const status = async () => (await app.inject({ method: "GET", url: `/v1/plugins/marketplace/${LISTING}/install-status`, headers: { authorization: `Bearer ${admin}` } })).json().data;
    expect((await status()).status).toBe("install_requested");

    await q.publish(COMMANDS.marketplaceInstall, msg);
    await q.drain();

    const rows = await pluginsFor(TENANT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: msg.messageId, state: "installed", createdBy: ACTOR });
    expect(rows[0]!.manifestJson).toMatchObject({ name: "GST Connector", version: "1.2.0", source: "marketplace", marketplaceListingId: LISTING });
    expect((await outboxFor(TENANT, EVENTS.pluginInstalled)).filter((o) => (o.payload as { pluginId?: string }).pluginId === msg.messageId)).toHaveLength(1);
    const audit = (await outboxFor(TENANT, "audit.event.record")).filter((o) => (o.payload as { action?: string }).action === "marketplace.install");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toMatchObject({ outcome: "success", resourceId: msg.messageId, reason: REASON, newValue: { listingId: LISTING, reason: REASON } });
    expect(await installs()).toBe(before + 1);
    expect(await status()).toMatchObject({ status: "installed", installId: msg.messageId });
    await app.close();
  });

  it("redelivery of the same messageId is a no-op (no second plugin, event, audit row or count bump)", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    const msg = installMsg();
    await q.publish(COMMANDS.marketplaceInstall, msg);
    await q.drain();
    const count = await installs();
    await q.publish(COMMANDS.marketplaceInstall, msg);
    await q.drain();
    expect(await pluginsFor(TENANT)).toHaveLength(1);
    expect(await outboxFor(TENANT, EVENTS.pluginInstalled)).toHaveLength(1);
    expect(await outboxFor(TENANT, "audit.event.record")).toHaveLength(1);
    expect(await installs()).toBe(count);
  });

  it("a second request (new messageId) for an already-installed listing is audited as skipped and creates no second copy", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    await q.publish(COMMANDS.marketplaceInstall, installMsg());
    await q.drain();
    await q.publish(COMMANDS.marketplaceInstall, installMsg());
    await q.drain();
    expect(await pluginsFor(TENANT)).toHaveLength(1);
    const outcomes = (await outboxFor(TENANT, "audit.event.record")).map((o) => (o.payload as { outcome: string }).outcome).sort();
    expect(outcomes).toEqual(["skipped", "success"]);
  });

  it("an unavailable listing installs nothing and is audited as a failure; tenants are isolated", async () => {
    await wipe();
    const q = tenantScopedQueue();
    registerMarketplaceConsumers(q);
    await q.publish(COMMANDS.marketplaceInstall, installMsg({ listingId: INACTIVE }));
    await q.publish(COMMANDS.marketplaceInstall, installMsg({ tenantId: OTHER_TENANT }));
    await q.drain();
    expect(await pluginsFor(TENANT)).toHaveLength(0);
    const fail = await outboxFor(TENANT, "audit.event.record");
    expect(fail).toHaveLength(1);
    expect(fail[0]!.payload).toMatchObject({ outcome: "failure", newValue: { detail: "LISTING_UNAVAILABLE" } });
    expect(await pluginsFor(OTHER_TENANT)).toHaveLength(1);
    expect(await pluginsFor(TENANT)).toHaveLength(0);
  });
});
