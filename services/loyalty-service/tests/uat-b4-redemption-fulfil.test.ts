/**
 * UAT B4 — GAP-LOYALTY-REDEMPTIONS-02 (fulfil / reject a pending redemption).
 *
 * Real Postgres + real RLS (non-superuser role). The command routes publish to a
 * capturing queue; the captured envelopes are then replayed into the real
 * consumers through a MemoryQueue, so route -> command -> consumer -> row is
 * exercised end to end. Unique per-file ids so parallel test files cannot collide.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

const captured = vi.hoisted(() => ({ msgs: [] as Array<{ type: string; envelope: Record<string, unknown> }> }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn().mockReturnValue("k") },
  queue: {
    publish: (type: string, envelope: Record<string, unknown>) => {
      captured.msgs.push({ type, envelope });
      return Promise.resolve();
    },
  },
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { programs } from "../src/modules/programs/schema.js";
import { enrolments } from "../src/modules/enrolments/schema.js";
import { redemptions } from "../src/modules/redemptions/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerRedemptionConsumers } from "../src/modules/redemptions/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const PROGRAM = randomUUID();
const ENROLMENT = randomUUID();
const START = 1000n;

const tx = <T>(fn: (t: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>, tenant = TENANT) =>
  runWithTenant(tenant, () => db.transaction(fn));

const token = (sub: string, roles: string[], tid = TENANT) => signToken({ sub, tid, roles, sid: randomUUID() }, SECRET);
// The gateway stamps x-tenant-id from the verified JWT; the tenant-tx hook reads it.
const auth = (t: string) => {
  const tid = JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()).tid as string;
  return { authorization: `Bearer ${t}`, "x-tenant-id": tid };
};

async function clean() {
  for (const t of [TENANT, OTHER_TENANT]) {
    await tx(async (x) => {
      await x.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await x.delete(redemptions).where(eq(redemptions.tenantId, t));
      await x.delete(enrolments).where(eq(enrolments.tenantId, t));
      await x.delete(programs).where(eq(programs.tenantId, t));
    }, t);
  }
}

async function seed() {
  captured.msgs.length = 0;
  await clean();
  await tx(async (x) => {
    await x.insert(programs).values({
      id: PROGRAM, tenantId: TENANT, name: "B4 fixture", status: "active",
      earnRatio: 100n, createdBy: MAKER, updatedBy: MAKER,
    });
    await x.insert(enrolments).values({
      id: ENROLMENT, tenantId: TENANT, programId: PROGRAM, profileId: randomUUID(),
      status: "active", tier: "base", pointsBalance: START, lifetimePoints: START,
      createdBy: MAKER, updatedBy: MAKER, version: 1,
    });
  });
}

/** Replay every command the routes published into the real consumers. */
async function drain() {
  const q = tenantScoped(new MemoryQueue());
  registerRedemptionConsumers(q);
  await q.start();
  for (const m of captured.msgs.splice(0)) await q.publish(m.type, m.envelope as never);
  await q.drain();
  await q.stop();
  return (q as unknown as MemoryQueue).dlq;
}

const redemption = async (id: string) =>
  (await tx((x) => x.select().from(redemptions).where(eq(redemptions.id, id))))[0]!;
const enrolmentRow = async () =>
  (await tx((x) => x.select().from(enrolments).where(eq(enrolments.id, ENROLMENT))))[0]!;
const seedPending = async (createdBy = MAKER, points = 100n) => {
  const id = randomUUID();
  await tx((x) =>
    x.insert(redemptions).values({
      id, tenantId: TENANT, enrolmentId: ENROLMENT, points, rewardType: "voucher",
      status: "pending", createdBy, version: 1,
    }),
  );
  await tx((x) => x.update(enrolments).set({ pointsBalance: START - points }).where(eq(enrolments.id, ENROLMENT)));
  return id;
};

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
beforeEach(seed);
afterAll(async () => { await clean(); await app.close(); await sqlClient.end(); });

describe("GAP-LOYALTY-REDEMPTIONS-02 fulfil / reject", () => {
  it("POST /redeem with deferFulfilment holds points and leaves the redemption pending", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/loyalty/redeem", headers: auth(token(MAKER, ["loyalty_admin"])),
      payload: { enrolmentId: ENROLMENT, points: 100, rewardType: "voucher", deferFulfilment: true },
    });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const row = await redemption(res.json().id);
    expect(row.status).toBe("pending");
    expect((await enrolmentRow()).pointsBalance).toBe(START - 100n);
  });

  it("POST /redeem without deferFulfilment keeps the instant-fulfil behaviour", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/loyalty/redeem", headers: auth(token(MAKER, ["loyalty_admin"])),
      payload: { enrolmentId: ENROLMENT, points: 100, rewardType: "voucher" },
    });
    expect(res.statusCode).toBe(202);
    await drain();
    expect((await redemption(res.json().id)).status).toBe("fulfilled");
  });

  it("a different admin fulfils a pending redemption; fulfilled_at/by and an audit row are written", async () => {
    const id = await seedPending();
    const res = await app.inject({
      method: "POST", url: `/v1/loyalty/redemptions/${id}/fulfil`,
      headers: auth(token(CHECKER, ["loyalty_admin"])), payload: { version: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const row = await redemption(id);
    expect(row.status).toBe("fulfilled");
    expect(row.fulfilledBy).toBe(CHECKER);
    expect(row.fulfilledAt).toBeInstanceOf(Date);
    const audit = await tx((x) => x.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(audit.map((a) => (a.payload as { action?: string }).action)).toContain("redemption.fulfil");
  });

  it("SoD: the officer who raised the redemption cannot fulfil it (route 403 and consumer guard)", async () => {
    const id = await seedPending(MAKER);
    const res = await app.inject({
      method: "POST", url: `/v1/loyalty/redemptions/${id}/fulfil`,
      headers: auth(token(MAKER, ["loyalty_admin"])), payload: { version: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code ?? res.json().code).toBe("SOD_VIOLATION");
    // bypass the route: a forged command from the maker is still refused by the consumer
    captured.msgs.push({
      type: "loyalty.redemption.fulfil",
      envelope: {
        messageId: randomUUID(), type: "loyalty.redemption.fulfil", tenantId: TENANT, actorId: MAKER,
        correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, version: 1 },
      },
    });
    await drain();
    expect((await redemption(id)).status).toBe("pending");
  });

  it("fulfilling twice (replayed command) is applied once; a non-pending row is 422", async () => {
    const id = await seedPending();
    const call = () => app.inject({
      method: "POST", url: `/v1/loyalty/redemptions/${id}/fulfil`,
      headers: auth(token(CHECKER, ["loyalty_admin"])), payload: { version: 1 },
    });
    expect((await call()).statusCode).toBe(202);
    await drain();
    expect((await call()).statusCode).toBe(422);
    expect((await redemption(id)).version).toBe(2);
  });

  it("reject requires a reason, marks the row rejected and restores the held points", async () => {
    const id = await seedPending();
    const noReason = await app.inject({
      method: "POST", url: `/v1/loyalty/redemptions/${id}/reject`,
      headers: auth(token(CHECKER, ["loyalty_admin"])), payload: { version: 1 },
    });
    expect(noReason.statusCode).toBe(400);
    const res = await app.inject({
      method: "POST", url: `/v1/loyalty/redemptions/${id}/reject`,
      headers: auth(token(CHECKER, ["loyalty_admin"])), payload: { reason: "Out of stock", version: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const row = await redemption(id);
    expect(row.status).toBe("rejected");
    expect(row.rejectReason).toBe("Out of stock");
    expect(row.rejectedAt).toBeInstanceOf(Date);
    expect((await enrolmentRow()).pointsBalance).toBe(START);
  });

  it("a loyalty_user cannot fulfil or reject; another tenant's redemption is 404", async () => {
    const id = await seedPending();
    for (const action of ["fulfil", "reject"]) {
      const res = await app.inject({
        method: "POST", url: `/v1/loyalty/redemptions/${id}/${action}`,
        headers: auth(token(CHECKER, ["loyalty_user"])), payload: { reason: "x", version: 1 },
      });
      expect(res.statusCode).toBe(403);
    }
    const foreign = await app.inject({
      method: "POST", url: `/v1/loyalty/redemptions/${id}/fulfil`,
      headers: auth(token(CHECKER, ["loyalty_admin"], OTHER_TENANT)), payload: { version: 1 },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("a stale version leaves the redemption pending (optimistic guard)", async () => {
    const id = await seedPending();
    await app.inject({
      method: "POST", url: `/v1/loyalty/redemptions/${id}/reject`,
      headers: auth(token(CHECKER, ["loyalty_admin"])), payload: { reason: "r", version: 7 },
    });
    await drain();
    expect((await redemption(id)).status).toBe("pending");
    expect((await enrolmentRow()).pointsBalance).toBe(START - 100n);
  });
});

