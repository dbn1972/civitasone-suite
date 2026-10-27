/**
 * D4c #26 (GAP-PROCUREMENT-EMD-BG-06): every EMD refund / PBG release records the
 * treasury or PFMS payment reference (UTR), and every forfeit records the
 * forfeiture order number. Mandatory at the API; persisted by the consumer and
 * visible on the register.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { withTenantConsumer, runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementEmd, procurementPbg } from "../src/modules/security/schema.js";
import { registerSecurityConsumers } from "../src/modules/security/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
let app: FastifyInstance;
const hdr = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer"], sid: "s" }, SECRET, 3600)}`, "x-tenant-id": TENANT });

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

async function seedEmd(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementEmd).values({
    id, tenantId: TENANT, emdNo: `EMD-${id.slice(0, 8)}`, vendorId: randomUUID(), amountMinor: 500000n, createdBy: ACTOR, updatedBy: ACTOR,
  })));
  return id;
}
async function seedPbg(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementPbg).values({
    id, tenantId: TENANT, pbgNo: `PBG-${id.slice(0, 8)}`, vendorId: randomUUID(), amountMinor: 500000n, createdBy: ACTOR, updatedBy: ACTOR,
  })));
  return id;
}

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, headers: hdr(), payload });

describe("API requires the payment reference / forfeiture order number", () => {
  const id = randomUUID();
  it("EMD refund without paymentRef is 400; with it is 202", async () => {
    expect((await post(`/v1/procurement/emd/${id}/refund`, {})).statusCode).toBe(400);
    expect((await post(`/v1/procurement/emd/${id}/refund`, { paymentRef: "   " })).statusCode).toBe(400);
    expect((await post(`/v1/procurement/emd/${id}/refund`, { paymentRef: "UTR2026102700123" })).statusCode).toBe(202);
  });
  it("PBG release without paymentRef is 400; with it is 202", async () => {
    expect((await post(`/v1/procurement/pbg/${id}/release`, { reason: "ok" })).statusCode).toBe(400);
    expect((await post(`/v1/procurement/pbg/${id}/release`, { paymentRef: "PFMS-9988" })).statusCode).toBe(202);
  });
  it("EMD and PBG forfeit without forfeitureOrderNo are 400; with it 202", async () => {
    for (const k of ["emd", "pbg"]) {
      expect((await post(`/v1/procurement/${k}/${id}/forfeit`, { reason: "breach" })).statusCode).toBe(400);
      expect((await post(`/v1/procurement/${k}/${id}/forfeit`, { forfeitureOrderNo: "FO/2026/17" })).statusCode).toBe(202);
    }
  });
});

describe("consumer persists the reference and the register shows it", () => {
  it("EMD refund then forfeit-order on another EMD", async () => {
    const q = wire(new MemoryQueue());
    registerSecurityConsumers(q);
    await q.start();
    const refundId = await seedEmd();
    const forfeitId = await seedEmd();
    const env = (type: string, payload: Record<string, unknown>) => ({ messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `c-${randomUUID()}`, schemaVersion: "1.0", payload });
    await q.publish(COMMANDS.emdRefund, env(COMMANDS.emdRefund, { id: refundId, tenantId: TENANT, reason: null, paymentRef: "UTR-REF-1" }));
    await q.publish(COMMANDS.emdForfeit, env(COMMANDS.emdForfeit, { id: forfeitId, tenantId: TENANT, reason: "breach", forfeitureOrderNo: "FO-9" }));
    await q.drain();
    const a = (await app.inject({ method: "GET", url: `/v1/procurement/emd/${refundId}`, headers: hdr() })).json();
    expect(a.status).toBe("refunded");
    expect(a.paymentRef).toBe("UTR-REF-1");
    const b = (await app.inject({ method: "GET", url: `/v1/procurement/emd/${forfeitId}`, headers: hdr() })).json();
    expect(b.status).toBe("forfeited");
    expect(b.forfeitureOrderNo).toBe("FO-9");
  });

  it("PBG release and forfeit", async () => {
    const q = wire(new MemoryQueue());
    registerSecurityConsumers(q);
    await q.start();
    const relId = await seedPbg();
    const forId = await seedPbg();
    const env = (type: string, payload: Record<string, unknown>) => ({ messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `c-${randomUUID()}`, schemaVersion: "1.0", payload });
    await q.publish(COMMANDS.pbgRelease, env(COMMANDS.pbgRelease, { id: relId, tenantId: TENANT, reason: null, paymentRef: "PFMS-77" }));
    await q.publish(COMMANDS.pbgForfeit, env(COMMANDS.pbgForfeit, { id: forId, tenantId: TENANT, reason: "x", forfeitureOrderNo: "FO-PBG-1" }));
    await q.drain();
    const a = (await app.inject({ method: "GET", url: `/v1/procurement/pbg/${relId}`, headers: hdr() })).json();
    expect(a.status).toBe("released");
    expect(a.paymentRef).toBe("PFMS-77");
    const b = (await app.inject({ method: "GET", url: `/v1/procurement/pbg/${forId}`, headers: hdr() })).json();
    expect(b.forfeitureOrderNo).toBe("FO-PBG-1");
  });
});
