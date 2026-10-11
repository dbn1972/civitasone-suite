/**
 * Terminal command outcomes beyond success (D-20, real Postgres).
 *
 * The consumer's success result is written inside the handler transaction; a
 * rejected or failed command rolled that transaction back, so its outcome is
 * recorded by the onOutcome hook (consumer.ts recordOutcome) in a SEPARATE
 * tenant-scoped transaction. This exercises that path end to end:
 *   - malformed payload  -> NonRetryableError -> 'rejected' (no row written)
 *   - payload tenantId != envelope tenantId -> 'rejected' (no cross-tenant write)
 *   - a retries-exhausted handler error (duplicate cycle id) -> 'failed'
 * and the GET /commands/:id view returns the status with NO free-text reason.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMovementConsumers } from "../src/modules/movement/consumer.js";
import { cycles } from "../src/modules/movement/schema.js";
import { authHeader, stubCompositionFetch } from "./_helpers.js";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const TOPIC = "smarttransfer.cycle.create";

let app: FastifyInstance;
let restoreFetch: () => void;
// maxAttempts 1: a failing handler reaches its terminal 'failed' outcome at once.
const q = new MemoryQueue({ maxAttempts: 1 });

beforeAll(async () => {
  restoreFetch = stubCompositionFetch(() => ({ configured: true, data: [{ name: "smarttransfer" }] }));
  app = await buildApp();
  await app.ready();
  registerMovementConsumers(q);
});

afterAll(async () => {
  restoreFetch();
  await app.close();
  await sqlClient.end();
});

function validPayload(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    name: "Outcome cycle",
    movementTypeId: randomUUID(),
    calendar: {
      opensAt: "2026-01-01T00:00:00.000Z",
      freezesAt: "2026-02-01T00:00:00.000Z",
      closesAt: "2026-03-01T00:00:00.000Z",
    },
    jurisdictionUnitId: null,
    ...over,
  };
}

async function publish(messageId: string, payload: Record<string, unknown>, tenantId = TENANT) {
  await q.publish(TOPIC, {
    messageId,
    type: TOPIC,
    tenantId,
    actorId: ACTOR,
    correlationId: "c-outcome",
    schemaVersion: "1.0",
    payload,
  });
  await q.drain();
}

async function statusOf(commandId: string, tenant = TENANT) {
  const res = await app.inject({
    method: "GET",
    url: `/v1/smarttransfer/commands/${commandId}`,
    headers: authHeader(tenant, ACTOR, ["smarttransfer_admin"]),
  });
  return res;
}

describe("recordOutcome / onOutcome (rejected + failed)", () => {
  it("a malformed payload is REJECTED (not retried), nothing is written, and the status route says rejected without a reason", async () => {
    const id = randomUUID();
    const messageId = randomUUID();
    await publish(messageId, validPayload({ id, name: "" }));

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(cycles).where(eq(cycles.id, id))),
    );
    expect(rows.length).toBe(0);

    const res = await statusOf(messageId);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data.status).toBe("rejected");
    expect(data.reason).toBeUndefined();
  });

  it("a payload whose tenantId differs from the envelope tenant is REJECTED and writes nothing", async () => {
    const id = randomUUID();
    const messageId = randomUUID();
    await publish(messageId, validPayload({ id, tenantId: OTHER_TENANT }));

    for (const t of [TENANT, OTHER_TENANT]) {
      const rows = await runWithTenant(t, () =>
        db.transaction((tx) => tx.select().from(cycles).where(eq(cycles.id, id))),
      );
      expect(rows.length).toBe(0);
    }
    const res = await statusOf(messageId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe("rejected");
  });

  it("a handler error that survives retries is recorded as FAILED, and a succeeded row is never downgraded", async () => {
    const id = randomUUID();
    const okMessage = randomUUID();
    await publish(okMessage, validPayload({ id }));
    expect(((await statusOf(okMessage)).json() as { data: { status: string } }).data.status).toBe("succeeded");

    // A different command re-using the same cycle id: PK violation -> thrown ->
    // handler tx rolled back -> terminal 'failed' captured only by onOutcome.
    const dupMessage = randomUUID();
    await publish(dupMessage, validPayload({ id }));
    const res = await statusOf(dupMessage);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data.status).toBe("failed");
    expect(data.reason).toBeUndefined();

    // The first (succeeded) command's result is untouched.
    expect(((await statusOf(okMessage)).json() as { data: { status: string } }).data.status).toBe("succeeded");

    // Exactly one cycle row exists for that id.
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(cycles).where(eq(cycles.id, id))),
    );
    expect(rows.length).toBe(1);
  });

  it("another tenant cannot read the rejected/failed results", async () => {
    const messageId = randomUUID();
    await publish(messageId, validPayload({ name: "" }));
    expect((await statusOf(messageId, OTHER_TENANT)).statusCode).toBe(404);
  });
});
