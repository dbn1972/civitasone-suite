/**
 * CLOS3-S1-11 -- editing a saved fee must supersede (retire + replace) the
 * schedule, not leave a duplicate live next to it.
 *
 * DB-backed: PATCH /v1/citizen/fees/schedules/:id -> 202 + queue -> consumer.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { COMMANDS } from "../src/topics.js";
import { registerFeePaymentConsumers } from "../src/modules/fee-payment/consumer.js";

registerFeePaymentConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const TENANT = randomUUID();
const ADMIN = randomUUID();
const OFFICER = randomUUID();
const CITIZEN = randomUUID();
const SERVICE = randomUUID();

const hdr = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s-clos3-s1-11" }, SECRET, 3600)}`,
  "content-type": "application/json",
  "x-tenant-id": TENANT,
});

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

type Sched = { id: string; serviceId: string; baseAmount: number; active: boolean; supersededBy: string | null };

describe("CLOS3-S1-11 fee schedule supersede", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  const list = async (): Promise<Sched[]> => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/fees/schedules", headers: hdr(OFFICER, ["citizen_officer"]) });
    return (res.json().data as Sched[]).filter((s) => s.serviceId === SERVICE);
  };

  const base = { name: "Trade licence fee", baseAmount: 50000, currency: "INR", exemptions: [] as unknown[] };

  it("edit retires the old schedule and leaves exactly one active (no duplicate)", async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/citizen/fees/schedules", headers: hdr(ADMIN, ["citizen_admin"]),
      payload: { serviceId: SERVICE, ...base },
    });
    expect(created.statusCode).toBe(202);
    const id1 = created.json().id as string;
    await waitFor(async () => (await list()).find((s) => s.id === id1));

    // Unchanged body: idempotent no-op, same id, nothing new written.
    const same = await app.inject({
      method: "PATCH", url: `/v1/citizen/fees/schedules/${id1}`, headers: hdr(ADMIN, ["citizen_admin"]), payload: base,
    });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ id: id1, status: "unchanged" });
    expect(await list()).toHaveLength(1);

    // Changed body: successor created, old one retired (bigint paise preserved).
    const edited = await app.inject({
      method: "PATCH", url: `/v1/citizen/fees/schedules/${id1}`, headers: hdr(ADMIN, ["citizen_admin"]),
      payload: { ...base, baseAmount: 75000 },
    });
    expect(edited.statusCode).toBe(202);
    const id2 = edited.json().id as string;
    expect(id2).not.toBe(id1);
    await waitFor(async () => (await list()).find((s) => s.id === id2));

    const rows = await list();
    expect(rows).toHaveLength(2);
    const active = rows.filter((s) => s.active);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: id2, baseAmount: 75000 });
    expect(rows.find((s) => s.id === id1)).toMatchObject({ active: false, supersededBy: id2 });

    // Editing the retired schedule again is refused, never forks the chain.
    const stale = await app.inject({
      method: "PATCH", url: `/v1/citizen/fees/schedules/${id1}`, headers: hdr(ADMIN, ["citizen_admin"]),
      payload: { ...base, baseAmount: 99000 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("SCHEDULE_SUPERSEDED");
  });

  it("a lost race (second supersede of an already-retired schedule) is rejected with an audit row, never forks the chain", async () => {
    const svc = randomUUID();
    const created = await app.inject({
      method: "POST", url: "/v1/citizen/fees/schedules", headers: hdr(ADMIN, ["citizen_admin"]),
      payload: { serviceId: svc, ...base },
    });
    const id1 = created.json().id as string;
    const listFor = async (): Promise<Sched[]> => {
      const res = await app.inject({ method: "GET", url: "/v1/citizen/fees/schedules", headers: hdr(OFFICER, ["citizen_officer"]) });
      return (res.json().data as Sched[]).filter((s) => s.serviceId === svc);
    };
    await waitFor(async () => (await listFor()).find((s) => s.id === id1));

    // Two racing edits that both passed the 409 pre-check: publish both supersede commands directly.
    const winner = randomUUID();
    const loser = randomUUID();
    const cmd = (successor: string, baseAmount: number) => queue.publish(COMMANDS.feeScheduleSupersede, {
      messageId: randomUUID(), type: COMMANDS.feeScheduleSupersede, tenantId: TENANT, actorId: ADMIN,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: successor, supersedes: id1, tenantId: TENANT, ...base, baseAmount },
    });
    await cmd(winner, 60000);
    await waitFor(async () => (await listFor()).find((s) => s.id === winner));
    await cmd(loser, 70000);

    const audit = await waitFor(async () => {
      const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
        tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))) as { payload: Record<string, unknown> }[];
      return rows.find((r) => r.payload["action"] === "fee_schedule_supersede_rejected" && r.payload["resourceId"] === loser);
    });
    expect(audit.payload).toMatchObject({
      outcome: "failure",
      newValue: { supersedes: id1, reason: "SCHEDULE_SUPERSEDED" },
    });
    const rows = await listFor();
    expect(rows.find((s) => s.id === loser)).toBeUndefined();
    expect(rows.filter((s) => s.active)).toHaveLength(1);
    expect(rows.find((s) => s.id === id1)).toMatchObject({ active: false, supersededBy: winner });
  });

  it("is admin-gated and tenant-scoped", async () => {
    const id = randomUUID();
    for (const h of [hdr(OFFICER, ["citizen_officer"]), hdr(CITIZEN, ["citizen"])]) {
      const res = await app.inject({ method: "PATCH", url: `/v1/citizen/fees/schedules/${id}`, headers: h, payload: base });
      expect(res.statusCode).toBe(403);
    }
    const unknown = await app.inject({
      method: "PATCH", url: `/v1/citizen/fees/schedules/${id}`, headers: hdr(ADMIN, ["citizen_admin"]), payload: base,
    });
    expect(unknown.statusCode).toBe(404);
    const noAuth = await app.inject({ method: "PATCH", url: `/v1/citizen/fees/schedules/${id}`, payload: base });
    expect(noAuth.statusCode).toBe(401);
  });
});
