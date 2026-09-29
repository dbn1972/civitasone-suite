/**
 * Water-connections consumer — CQRS wiring integration test.
 *
 * Before this: water-connections/routes.ts published commands with no
 * consumer.ts registered — 202 accepted, nothing ever persisted; no
 * `water_connections` schema ever existed in Postgres so GET list/by-id hit
 * "relation does not exist" (500) or came back empty. This suite proves: a
 * real HTTP POST -> consumer -> DB round trip for an application, the full
 * application lifecycle (submit/feasibility/reject and, separately,
 * approve/install/activate), HTTP GET list/by-id for both applications and
 * connections, idempotency, and cross-tenant RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { assetWaterApplications, assetWaterConnections } from "../src/modules/water-connections/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerWaterConnectionConsumers } from "../src/modules/water-connections/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000f3";
const ACTOR_A  = "cccccccc-3333-4000-8000-0000000000f3";
const TENANT_B = "bbbbbbbb-2222-4000-8000-0000000000f4";
const ACTOR_B  = "dddddddd-4444-4000-8000-0000000000f4";

function token(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["water_admin", "super_admin"], sid: "s-water-conn" }, SECRET, 3600);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;

beforeAll(async () => {
  registerWaterConnectionConsumers(appQueue);
  await appQueue.start();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Water-connections consumer — CQRS wiring (integration)", () => {
  let applicationId: string;

  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => {
      await tx.delete(assetWaterConnections).where(eq(assetWaterConnections.tenantId, TENANT_A));
      await tx.delete(assetWaterApplications).where(eq(assetWaterApplications.tenantId, TENANT_A));
    });
  });

  it("POST /v1/assets/water/applications persists a real row (not silently dropped)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/water/applications",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { applicantName: "Ravi Kumar", applicantPhone: "9876543210", connectionType: "domestic", pipeSize: "15mm" },
    });
    expect(res.statusCode).toBe(202);
    applicationId = res.json().data.id;
    expect(applicationId).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterApplications).where(eq(assetWaterApplications.id, applicationId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.applicationNumber).toBeTruthy();
    expect(rows[0]?.feeMinor).toBe(2500_00n); // domestic + 15mm per FEE_TABLE
  });

  it("GET /v1/assets/water/applications returns the persisted row (not empty)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/water/applications",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((a: { id: string }) => a.id === applicationId)).toBe(true);
  });

  it("GET /v1/assets/water/applications/:id returns the persisted row", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/water/applications/${applicationId}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(applicationId);
  });

  it("unknown id returns 404, not a 500", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/water/applications/${randomUUID()}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("idempotent: replaying the same messageId does not duplicate", async () => {
    const q = new MemoryQueue();
    registerWaterConnectionConsumers(q);
    await q.start();
    const id = randomUUID();
    const msgId = randomUUID();
    const publish = () => q.publish(COMMANDS.waterApplicationCreate, {
      messageId: msgId, type: COMMANDS.waterApplicationCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-wc-1", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, applicantName: "Idem Test", applicantPhone: "9000000000", connectionType: "commercial" },
    });
    await publish();
    await new Promise((r) => setTimeout(r, 300));
    await publish(); // replay
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterApplications).where(eq(assetWaterApplications.id, id)));
    expect(rows).toHaveLength(1);
    const seen = await asTenant(TENANT_A, (tx) => tx.select().from(processed).where(eq(processed.messageId, msgId)));
    expect(seen).toHaveLength(1);

    await asTenant(TENANT_A, async (tx) => { await tx.delete(assetWaterApplications).where(eq(assetWaterApplications.id, id)); });
  });

  it("submit -> feasibility -> reject persists each transition and the reason", async () => {
    const submitRes = await app.inject({
      method: "POST", url: `/v1/assets/water/applications/${applicationId}/submit`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(submitRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    let rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterApplications).where(eq(assetWaterApplications.id, applicationId)));
    expect(rows[0]?.status).toBe("submitted");

    const feasRes = await app.inject({
      method: "POST", url: `/v1/assets/water/applications/${applicationId}/feasibility`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { report: { feasible: false, reason: "no main line within 200m" } },
    });
    expect(feasRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterApplications).where(eq(assetWaterApplications.id, applicationId)));
    expect(rows[0]?.status).toBe("feasibility_check");
    expect(rows[0]?.feasibilityReport).toMatchObject({ feasible: false });

    const rejectRes = await app.inject({
      method: "POST", url: `/v1/assets/water/applications/${applicationId}/reject`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { reason: "no main line within 200m" },
    });
    expect(rejectRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterApplications).where(eq(assetWaterApplications.id, applicationId)));
    expect(rows[0]?.status).toBe("rejected");
    expect(rows[0]?.rejectionReason).toBe("no main line within 200m");
  });

  it("approve -> install -> activate: real connection row, GET list/by-id return it", async () => {
    const appId2Res = await app.inject({
      method: "POST", url: "/v1/assets/water/applications",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { applicantName: "Second Applicant", applicantPhone: "9123456780", connectionType: "domestic", pipeSize: "20mm" },
    });
    const applicationId2 = appId2Res.json().data.id;
    await new Promise((r) => setTimeout(r, 300));

    const approveRes = await app.inject({
      method: "POST", url: `/v1/assets/water/applications/${applicationId2}/approve`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(approveRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));

    const installRes = await app.inject({
      method: "POST", url: `/v1/assets/water/applications/${applicationId2}/install`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { meterId: "MTR-0001" },
    });
    expect(installRes.statusCode).toBe(202);
    const connectionId = installRes.json().data.id;
    await new Promise((r) => setTimeout(r, 300));

    const connRows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterConnections).where(eq(assetWaterConnections.id, connectionId)));
    expect(connRows).toHaveLength(1);
    expect(connRows[0]?.applicationId).toBe(applicationId2);
    expect(connRows[0]?.connectionType).toBe("domestic"); // copied from the application, not in the install payload
    expect(connRows[0]?.meterId).toBe("MTR-0001");
    expect(connRows[0]?.installationDate).toBeTruthy();

    const listRes = await app.inject({
      method: "GET", url: "/v1/assets/water/connections",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.some((c: { id: string }) => c.id === connectionId)).toBe(true);

    const getRes = await app.inject({
      method: "GET", url: `/v1/assets/water/connections/${connectionId}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.id).toBe(connectionId);

    // NOTE: despite the URL living under ".../applications/:id/activate",
    // commands.ts's activateConnection(ctx, id) treats :id as the CONNECTION
    // id (it becomes waterConnectionActivate's payload.id, looked up against
    // asset_water_connections) -- a pre-existing route-naming inconsistency,
    // not something this fix changes. Exercised here with connectionId to
    // match that real semantics.
    const activateRes = await app.inject({
      method: "POST", url: `/v1/assets/water/applications/${connectionId}/activate`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(activateRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));

    const activatedRows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterConnections).where(eq(assetWaterConnections.id, connectionId)));
    expect(activatedRows[0]?.status).toBe("active");
    expect(activatedRows[0]?.activationDate).toBeTruthy();
  });
});

describe("Water-connections — cross-tenant RLS isolation", () => {
  const applicationIdA = randomUUID();

  beforeAll(async () => {
    const q = new MemoryQueue();
    registerWaterConnectionConsumers(q);
    await q.start();
    await q.publish(COMMANDS.waterApplicationCreate, {
      messageId: randomUUID(), type: COMMANDS.waterApplicationCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-rls-wc-1", schemaVersion: "1.0",
      payload: { id: applicationIdA, tenantId: TENANT_A, applicantName: "RLS Test", applicantPhone: "9988776655", connectionType: "domestic" },
    });
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();
  });
  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => { await tx.delete(assetWaterApplications).where(eq(assetWaterApplications.id, applicationIdA)); });
  });

  it("Tenant B cannot see Tenant A's application via GET list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/water/applications",
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((a: { id: string }) => a.id === applicationIdA)).toBe(false);
  });

  it("Tenant B GET by id returns 404 (not another tenant's row)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/water/applications/${applicationIdA}`,
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B's tenant-scoped DB read of Tenant A's row returns zero rows (RLS, not app filter)", async () => {
    const rows = await asTenant(TENANT_B, (tx) => tx.select().from(assetWaterApplications).where(and(eq(assetWaterApplications.id, applicationIdA))));
    expect(rows).toHaveLength(0);
  });
});
