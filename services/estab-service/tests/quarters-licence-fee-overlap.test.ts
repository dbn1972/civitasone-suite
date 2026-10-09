/**
 * PR #1949 review round 1, item 8 — the 0049 exclusion constraint must not turn
 * into a silent drop.
 *  - the route pre-checks overlap and answers 409 (and 400 for an inverted range);
 *  - if an overlapping rate still reaches the consumer (race past the
 *    pre-check), the 23P01 is an AUDITED refusal and the row is not inserted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Queue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabLicenceFeeRates } from "../src/modules/quarters/schema.js";
import { registerQuarterConsumers } from "../src/modules/quarters/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "7ca10001-0000-4000-8000-0000000000f7";
const ACTOR = "7ca10001-0000-4000-8000-0000000000f8";

type Handler = (msg: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();
const fakeQueue = { subscribe: (t: string, h: Handler) => void handlers.set(t, h) } as unknown as Queue;
const messageIds: string[] = [];

const headers = () => ({
  "x-tenant-id": TENANT,
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["estab_admin"], sid: "s1" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
beforeAll(async () => {
  registerQuarterConsumers(fakeQueue);
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.delete(estabLicenceFeeRates).where(eq(estabLicenceFeeRates.tenantId, TENANT))));
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  if (messageIds.length) await sqlClient`DELETE FROM _inbox.processed WHERE message_id IN ${sqlClient(messageIds)}`;
  await app.close();
  await sqlClient.end();
});

async function deliverRate(id: string, effectiveFrom: string, effectiveTo?: string): Promise<void> {
  const messageId = randomUUID();
  messageIds.push(messageId);
  await runWithTenant(TENANT, () => handlers.get(COMMANDS.quarterLicenceFeeRate)!({
    messageId, type: COMMANDS.quarterLicenceFeeRate, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ov",
    schemaVersion: "1.0",
    payload: { id, tenantId: TENANT, quarterType: "type_iii", payLevel: "level_5", monthlyMinor: 100000, currency: "INR", effectiveFrom, effectiveTo },
  }));
}

describe("licence-fee overlap is surfaced, not swallowed", () => {
  it("route: 409 on an overlapping period, 400 on an inverted range, 202 on an adjacent period", async () => {
    const first = randomUUID();
    await deliverRate(first, "2026-01-01", "2026-06-30");

    const body = { quarterType: "type_iii", payLevel: "level_5", monthlyMinor: 120000 };
    const overlap = await app.inject({ method: "POST", url: "/v1/estab/quarter-licence-fees", headers: headers(), payload: { ...body, effectiveFrom: "2026-06-30" } });
    expect(overlap.statusCode).toBe(409);
    expect(JSON.stringify(overlap.json())).toContain(first);

    const inverted = await app.inject({ method: "POST", url: "/v1/estab/quarter-licence-fees", headers: headers(), payload: { ...body, effectiveFrom: "2026-09-01", effectiveTo: "2026-08-01" } });
    expect(inverted.statusCode).toBe(400);

    const adjacent = await app.inject({ method: "POST", url: "/v1/estab/quarter-licence-fees", headers: headers(), payload: { ...body, effectiveFrom: "2026-07-01" } });
    expect(adjacent.statusCode).toBe(202);
  });

  it("consumer: a 23P01 that slips past the pre-check is an audited refusal and inserts nothing", async () => {
    const winner = randomUUID();
    const loser = randomUUID();
    await deliverRate(winner, "2027-01-01", "2027-12-31");
    await deliverRate(loser, "2027-06-01", "2028-06-01"); // overlaps the winner -> exclusion violation

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabLicenceFeeRates).where(eq(estabLicenceFeeRates.id, loser))));
    expect(rows).toHaveLength(0);

    const audits = await sqlClient`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'`;
    const refused = (audits as unknown as Array<{ payload: Record<string, unknown> }>)
      .map((r) => r.payload).filter((p) => p.resourceId === loser);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ action: "licence_fee_rate_refused_overlap", outcome: "refused" });
  });
});
