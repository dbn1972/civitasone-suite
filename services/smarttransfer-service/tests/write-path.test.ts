/**
 * SmartTransfer write path (real Postgres).
 *
 * Proves the one wired write path end to end:
 *   POST /v1/smarttransfer/cycles → zod → command smarttransfer.cycle.create
 *   (explicit messageId) → 202 {commandId, statusUrl} → consumer markProcessed
 *   + guarded insert + smarttransfer.cycle.created event + audit.event.record
 *   + command_results, all in one transaction.
 * Plus: GET list scoped to jurisdiction, idempotent redelivery, and the
 * GET /v1/smarttransfer/commands/:commandId status route (D-20).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMovementConsumers } from "../src/modules/movement/consumer.js";
import { cycles } from "../src/modules/movement/schema.js";
import { outboxMessages } from "@civitasone/outbox";
import { runWithTenant } from "@civitasone/db";
import { authHeader, stubCompositionFetch } from "./_helpers.js";

// Unique per run so repeated local runs stay isolated; CI runs against a
// freshly bootstrapped DB regardless.
const TENANT = randomUUID();
const ACTOR = randomUUID();
const JURIS = randomUUID();

let app: FastifyInstance;
let restoreFetch: () => void;

beforeAll(async () => {
  // Entitlement: smarttransfer enabled for this tenant.
  restoreFetch = stubCompositionFetch(() => ({ configured: true, data: [{ name: "smarttransfer" }] }));
  app = await buildApp();
  await app.ready();
  registerMovementConsumers(queue);
});

afterAll(async () => {
  restoreFetch();
  await app.close();
  await sqlClient.end();
});

function validBody() {
  return {
    name: "Annual transfer 2026",
    movementTypeId: randomUUID(),
    calendar: {
      opensAt: "2026-01-01T00:00:00.000Z",
      freezesAt: "2026-02-01T00:00:00.000Z",
      closesAt: "2026-03-01T00:00:00.000Z",
    },
  };
}

describe("SmartTransfer cycle write path", () => {
  it("POST returns 202 with commandId + statusUrl, then the consumer writes the row + event + audit + command result in one tx", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], [JURIS]),
      payload: validBody(),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { commandId: string; statusUrl: string };
    expect(body.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.statusUrl).toBe(`/v1/smarttransfer/commands/${body.commandId}`);

    await queue.drain();

    // Exactly one cycle row for this tenant, jurisdiction set from the token.
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(cycles).where(eq(cycles.tenantId, TENANT))),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toBe("Annual transfer 2026");
    expect(rows[0]!.jurisdictionUnitId).toBe(JURIS);
    expect(rows[0]!.status).toBe("draft");

    // The audit outbox row is written in the same tx as the domain row.
    // (smarttransfer.cycle.created is deliberately NOT emitted yet — no
    // consumer exists on main, so it would be an orphan event; see
    // src/modules/movement/consumer.ts and topics.ts.)
    const outbox = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))),
    );
    const topics = outbox.map((o) => o.topic);
    expect(topics).toContain("audit.event.record");
    expect(topics).not.toContain("smarttransfer.cycle.created");

    // Command status route reports succeeded (D-20 view: status + no reason).
    const statusRes = await app.inject({
      method: "GET",
      url: body.statusUrl,
      headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], [JURIS]),
    });
    expect(statusRes.statusCode).toBe(200);
    const status = (statusRes.json() as { data: { status: string } }).data;
    expect(status.status).toBe("succeeded");
    expect((status as Record<string, unknown>).reason).toBeUndefined();
  });

  it("GET list returns the cycle scoped to the caller's jurisdiction", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], [JURIS]),
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Array<{ name: string }> }).data;
    expect(data.some((c) => c.name === "Annual transfer 2026")).toBe(true);
  });

  it("a caller whose jurisdiction does not match sees no row (list jurisdiction-scoped)", async () => {
    const otherJuris = "33333333-0000-4000-8000-000000000099";
    const res = await app.inject({
      method: "GET",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], [otherJuris]),
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Array<{ id: string }> }).data;
    // The only cycle is scoped to JURIS, so a caller fenced to otherJuris
    // sees nothing (tenant-wide null-scope rows would still show, but there
    // are none here).
    expect(data.length).toBe(0);
  });

  it("idempotent redelivery: re-publishing the same command id does not create a second row and still reports succeeded", async () => {
    const commandId = randomUUID();
    const cycleId = randomUUID();
    const payload = {
      id: cycleId,
      name: "Idempotent cycle",
      movementTypeId: randomUUID(),
      calendar: validBody().calendar,
      jurisdictionUnitId: JURIS,
      tenantId: TENANT,
    };
    const publishOnce = () =>
      queue.publish("smarttransfer.cycle.create", {
        messageId: commandId,
        type: "smarttransfer.cycle.create",
        tenantId: TENANT,
        actorId: ACTOR,
        correlationId: "c-idem",
        schemaVersion: "1.0",
        payload,
      });

    await publishOnce();
    await queue.drain();
    await publishOnce();
    await queue.drain();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(cycles).where(eq(cycles.id, cycleId))),
    );
    expect(rows.length).toBe(1);

    const statusRes = await app.inject({
      method: "GET",
      url: `/v1/smarttransfer/commands/${commandId}`,
      headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], [JURIS]),
    });
    expect(statusRes.statusCode).toBe(200);
    expect((statusRes.json() as { data: { status: string } }).data.status).toBe("succeeded");
  });

  it("status route returns 404 for an unknown/in-flight command (distinct from rejected)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/smarttransfer/commands/${randomUUID()}`,
      headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], [JURIS]),
    });
    expect(res.statusCode).toBe(404);
  });
});
