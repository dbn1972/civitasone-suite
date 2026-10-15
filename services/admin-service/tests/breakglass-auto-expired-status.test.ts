/**
 * GAP-TENANT-ADMIN-BREAKGLASS-06 (real DB, real Fastify, real sweeper): a grant the
 * TTL sweeper closes must STILL read back as "auto_expired" (it used to become a
 * plain "ended" the moment the sweeper set closed_at), carry close reason
 * "auto_expired" and no human "closed by"; a grant an operator closes reads
 * "ended" / "manual" with the closer. Pure derivation is pinned as well.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { adminBreakGlassLog } from "../src/modules/support/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { sweepExpiredBreakGlass } from "../src/modules/support/consumer.js";
import * as repo from "../src/modules/support/repo.js";
import { breakGlassStatus } from "../src/modules/support/domain.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const T2 = randomUUID(); // a tenant may hold only ONE open grant, so the live one lives in its own tenant
const ACTOR = randomUUID();
const CLOSER = randomUUID();
const EXPIRED = randomUUID();
const MANUAL = randomUUID();
const LIVE = randomUUID();
const bearer = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, roles: ["platform_admin"], tid: T } as never, SECRET)}` });

const grant = (id: string, expiresAt: Date, tenantId = T) => ({
  id, tenantId, ticketId: randomUUID(), actorId: ACTOR, reason: "incident investigation",
  expiresAt, correlationId: randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
});
async function cleanup() {
  for (const t of [T, T2]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(adminBreakGlassLog).where(eq(adminBreakGlassLog.tenantId, t));
    }));
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await runWithTenant(T, () => db.transaction((tx) => tx.insert(adminBreakGlassLog).values(grant(MANUAL, new Date(Date.now() + 3600_000)))));
  await runWithTenant(T, () => db.transaction((tx) => repo.closeBreakGlass(tx, MANUAL, CLOSER, "manual")));
  await runWithTenant(T, () => db.transaction((tx) => tx.insert(adminBreakGlassLog).values(grant(EXPIRED, new Date(Date.now() - 60_000)))));
  await runWithTenant(T2, () => db.transaction((tx) => tx.insert(adminBreakGlassLog).values(grant(LIVE, new Date(Date.now() + 3600_000), T2))));
  await sweepExpiredBreakGlass();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const detail = async (id: string, tenant = T) =>
  (await app.inject({ method: "GET", url: `/v1/admin/breakglass/${id}?tenantId=${tenant}`, headers: bearer() })).json() as Record<string, unknown>;

describe("break-glass status after the sweeper has run", () => {
  it("a swept grant is auto_expired with reason auto_expired and no human closer", async () => {
    const d = await detail(EXPIRED);
    expect(d.status).toBe("auto_expired");
    expect(d.closeReason).toBe("auto_expired");
    expect(d.closedBy).toBeNull();
    expect(d.endedAt).toEqual(expect.any(String));
  });

  it("an operator-closed grant is ended / manual with the closer", async () => {
    const d = await detail(MANUAL);
    expect(d.status).toBe("ended");
    expect(d.closeReason).toBe("manual");
    expect(d.closedBy).toBe(CLOSER);
  });

  it("an open, unexpired grant stays active; the list agrees with the detail", async () => {
    expect((await detail(LIVE, T2)).status).toBe("active");
    const list = await app.inject({ method: "GET", url: `/v1/admin/breakglass?tenantId=${T}&limit=50`, headers: bearer() });
    const rows = list.json() as Array<{ id: string; status: string }>;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    const live = (await app.inject({ method: "GET", url: `/v1/admin/breakglass?tenantId=${T2}&limit=50`, headers: bearer() })).json() as Array<{ id: string; status: string }>;
    byId[LIVE] = live.find((r) => r.id === LIVE)!.status;
    expect(byId[EXPIRED]).toBe("auto_expired");
    expect(byId[MANUAL]).toBe("ended");
    expect(byId[LIVE]).toBe("active");
  });
});

describe("breakGlassStatus (pure)", () => {
  const past = new Date(Date.now() - 1000);
  const future = new Date(Date.now() + 100000);
  it("derives every state", () => {
    expect(breakGlassStatus({ closedAt: null, closeReason: null, expiresAt: future })).toBe("active");
    expect(breakGlassStatus({ closedAt: null, closeReason: null, expiresAt: past })).toBe("auto_expired");
    expect(breakGlassStatus({ closedAt: past, closeReason: "manual", expiresAt: future })).toBe("ended");
    expect(breakGlassStatus({ closedAt: past, closeReason: null, expiresAt: future })).toBe("ended");
    expect(breakGlassStatus({ closedAt: past, closeReason: "auto_expired", expiresAt: past })).toBe("auto_expired");
  });
});
