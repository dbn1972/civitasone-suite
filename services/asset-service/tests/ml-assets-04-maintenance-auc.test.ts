/**
 * ml-assets-04 backend proof (real Postgres):
 *  - GAP-ASSETS-MAINTENANCE-01: POST work-orders carries maintenanceType through the
 *    queue consumer into the (pre-existing) maintenance_type column.
 *  - GAP-ASSETS-MAINTENANCE-02/-04: the queue list and the per-asset history return the
 *    same shape, including the real asset code/name (not a truncated UUID).
 *  - GAP-ASSETS-PROJECTS-05: AUC create audits the clerk's reason.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { assetAssets } from "../src/modules/register/schema.js";
import { functionalLocations, projectAuc, assetSettings } from "../src/modules/enterprise/schema.js";
import { assetWorkOrders } from "../src/modules/maintenance/schema.js";
import { registerMaintenanceConsumers } from "../src/modules/maintenance/consumer.js";
import { registerF3EnterpriseConsumers } from "../src/modules/enterprise/f3-consumer.js";
import { workOrderBody } from "../src/modules/maintenance/validators.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000004a1";
const ACTOR = "cccccccc-3333-4000-8000-0000000004a1";
const ASSET = randomUUID();
const token = () => signToken({ sub: ACTOR, tid: TENANT, roles: ["asset_admin", "super_admin"], sid: "s-ml04" }, SECRET, 3600);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;
beforeAll(async () => {
  await asTenant((tx) => tx.delete(projectAuc).where(eq(projectAuc.tenantId, TENANT)));
  app = await buildApp();
  await app.ready();
  await asTenant((tx) => tx.insert(assetAssets).values({
    id: ASSET, tenantId: TENANT, name: "Diesel Generator 62kVA", code: "DG-062", categoryId: randomUUID(),
    acquisitionDate: "2024-01-01", createdBy: ACTOR, updatedBy: ACTOR,
  }));
});
afterAll(async () => {
  await asTenant((tx) => tx.delete(projectAuc).where(eq(projectAuc.tenantId, TENANT)));
  await sqlClient`delete from _outbox.messages where tenant_id = ${TENANT}`;
  await asTenant(async (tx) => {
    await tx.delete(assetWorkOrders).where(eq(assetWorkOrders.tenantId, TENANT));
    await tx.delete(assetAssets).where(eq(assetAssets.id, ASSET));
    await tx.delete(functionalLocations).where(eq(functionalLocations.tenantId, TENANT));
    await tx.delete(assetSettings).where(eq(assetSettings.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

describe("workOrderBody validator", () => {
  it("accepts a known maintenanceType and rejects an unknown one", () => {
    const base = { assetId: randomUUID(), scheduledDate: "2026-10-05" };
    expect(workOrderBody.parse({ ...base, maintenanceType: "breakdown" }).maintenanceType).toBe("breakdown");
    expect(workOrderBody.parse(base).maintenanceType).toBeUndefined();
    expect(() => workOrderBody.parse({ ...base, maintenanceType: "bogus" })).toThrow();
  });
});

describe("maintenance type + asset label round trip", () => {
  const woBreakdown = randomUUID();
  const woDefault = randomUUID();

  it("persists maintenanceType (default corrective) and lists both with asset code/name", async () => {
    const q = new MemoryQueue();
    registerMaintenanceConsumers(q);
    await q.start();
    for (const [id, extra] of [[woBreakdown, { maintenanceType: "breakdown" }], [woDefault, {}]] as const) {
      await q.publish(COMMANDS.workOrderCreate, {
        messageId: randomUUID(), type: COMMANDS.workOrderCreate,
        tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ml04", schemaVersion: "1.0",
        payload: { id, tenantId: TENANT, assetId: ASSET, scheduledDate: "2026-10-05", ...extra },
      });
    }
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await asTenant((tx) => tx.select().from(assetWorkOrders).where(and(eq(assetWorkOrders.tenantId, TENANT))));
    const byId = new Map(rows.map((r) => [r.id, r.maintenanceType]));
    expect(byId.get(woBreakdown)).toBe("breakdown");
    expect(byId.get(woDefault)).toBe("corrective");
  });

  it("GET /maintenance and GET /assets/:id/maintenance return the same shape with assetCode/assetName", async () => {
    const headers = { authorization: `Bearer ${token()}` };
    const queue = await app.inject({ method: "GET", url: "/v1/assets/maintenance?limit=50", headers });
    const hist = await app.inject({ method: "GET", url: `/v1/assets/assets/${ASSET}/maintenance`, headers });
    expect(queue.statusCode).toBe(200);
    expect(hist.statusCode).toBe(200);
    const q = (JSON.parse(queue.body) as { data: Array<Record<string, unknown>> }).data.filter((r) => r.assetId === ASSET);
    const h = (JSON.parse(hist.body) as { data: Array<Record<string, unknown>> }).data;
    expect(q).toHaveLength(2);
    expect(h).toHaveLength(2);
    for (const r of [...q, ...h]) {
      expect(r.assetCode).toBe("DG-062");
      expect(r.assetName).toBe("Diesel Generator 62kVA");
      expect(["breakdown", "corrective"]).toContain(r.maintenanceType);
    }
    expect(Object.keys(q[0]!).sort()).toEqual(Object.keys(h[0]!).sort());
  });

  it("POST /work-orders forwards maintenanceType to the command payload", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/work-orders",
      headers: { authorization: `Bearer ${token()}` },
      payload: { assetId: ASSET, scheduledDate: "2026-10-06", maintenanceType: "preventive" },
    });
    expect(res.statusCode).toBe(202);
    const bad = await app.inject({
      method: "POST", url: "/v1/assets/work-orders",
      headers: { authorization: `Bearer ${token()}` },
      payload: { assetId: ASSET, scheduledDate: "2026-10-06", maintenanceType: "nope" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("AUC create audit (GAP-ASSETS-PROJECTS-05)", () => {
  it("writes an audit outbox event carrying the reason", async () => {
    const q = new MemoryQueue();
    registerF3EnterpriseConsumers(q);
    await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ml04-auc", schemaVersion: "1.0",
      payload: { op: "auc_create", id, tenantId: TENANT, projectCode: "AUC-ML04", name: "Block C", amountMinor: 0, reason: "Sanctioned vide order 12/2026" },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();
    const out = await sqlClient`select payload from _outbox.messages where tenant_id = ${TENANT} and topic = 'audit.event.record' and payload->>'resourceId' = ${id}`;
    expect(out).toHaveLength(1);
    const p = out[0]!.payload as { action: string; resourceType: string; details: { reason: string; projectCode: string } };
    expect(p.action).toBe("create");
    expect(p.resourceType).toBe("auc_project");
    expect(p.details).toEqual({ projectCode: "AUC-ML04", amountMinor: 0, reason: "Sanctioned vide order 12/2026" });
  });

  it("POST /projects/auc accepts reason and rejects a 1-char reason", async () => {
    const ok = await app.inject({
      method: "POST", url: "/v1/assets/projects/auc", headers: { authorization: `Bearer ${token()}` },
      payload: { projectCode: "X1", name: "X", amountMinor: 0, reason: "Approved by Board" },
    });
    expect(ok.statusCode).toBe(202);
    const bad = await app.inject({
      method: "POST", url: "/v1/assets/projects/auc", headers: { authorization: `Bearer ${token()}` },
      payload: { projectCode: "X1", name: "X", amountMinor: 0, reason: "x" },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: "POST", url: "/v1/assets/projects/auc", headers: { authorization: `Bearer ${token()}` },
      payload: { projectCode: "X1", name: "X", amountMinor: 0 },
    });
    expect(missing.statusCode).toBe(400);
    const huge = await app.inject({
      method: "POST", url: "/v1/assets/projects/auc", headers: { authorization: `Bearer ${token()}` },
      payload: { projectCode: "X1", name: "X", amountMinor: 1e17, reason: "Approved by Board" },
    });
    expect(huge.statusCode).toBe(400);
  });
});

describe("AUC capitalize double-click guard", () => {
  it("creates exactly one asset when capitalize is delivered twice", async () => {
    const q = new MemoryQueue();
    registerF3EnterpriseConsumers(q);
    await q.start();
    // The direct (single-actor) consumer path is only valid while the tenant has maker-checker switched OFF.
    await asTenant((tx) => tx.insert(assetSettings).values({ tenantId: TENANT, capitalizeMakerChecker: false, cwipAccountCode: "1300", updatedBy: ACTOR }).onConflictDoNothing());
    const aucId = randomUUID();
    await q.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR, correlationId: "c", schemaVersion: "1.0",
      payload: { op: "auc_create", id: aucId, tenantId: TENANT, projectCode: "AUC-DBL", name: "Dbl", amountMinor: 500, reason: "test reason" },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    for (let i = 0; i < 2; i++) {
      await q.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR, correlationId: "c", schemaVersion: "1.0",
        payload: { op: "auc_capitalize", id: randomUUID(), tenantId: TENANT, aucId, assetId: randomUUID(), projectCode: "AUC-DBL", name: "Dbl", accumulatedMinor: "500" },
      });
    }
    await new Promise<void>((r) => setTimeout(r, 700));
    await q.stop();
    const assets = await asTenant((tx) => tx.select().from(assetAssets).where(eq(assetAssets.code, "AUC/AUC-DBL")));
    expect(assets).toHaveLength(1);
    await asTenant((tx) => tx.delete(assetAssets).where(eq(assetAssets.code, "AUC/AUC-DBL")));
  });
});

describe("functional locations (GAP-ASSETS-LOCATIONS-02/-06)", () => {
  const LOC = randomUUID();
  const headers = () => ({ authorization: `Bearer ${token()}` });

  it("rejects a duplicate code with 409 instead of accepting and silently dropping it", async () => {
    await asTenant((tx) => tx.insert(functionalLocations).values({ id: LOC, tenantId: TENANT, code: "BLDG-A", name: "Block A", createdBy: ACTOR }));
    const dup = await app.inject({ method: "POST", url: "/v1/assets/locations", headers: headers(), payload: { code: "BLDG-A", name: "Again" } });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).code).toBe("DUPLICATE_CODE");
    const fresh = await app.inject({ method: "POST", url: "/v1/assets/locations", headers: headers(), payload: { code: "BLDG-B", name: "Block B", parentId: LOC } });
    expect(fresh.statusCode).toBe(202);
  });

  it("rejects a parentId that does not exist in the tenant with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/assets/locations", headers: headers(), payload: { code: "ORPHAN-1", name: "O", parentId: randomUUID() } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("INVALID_PARENT");
  });

  it("lists locations ordered by code with real paging", async () => {
    await asTenant((tx) => tx.insert(functionalLocations).values([
      { tenantId: TENANT, code: "ZZ-3", name: "3", createdBy: ACTOR },
      { tenantId: TENANT, code: "ZZ-1", name: "1", createdBy: ACTOR },
      { tenantId: TENANT, code: "ZZ-2", name: "2", createdBy: ACTOR },
    ]));
    const all = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/locations?limit=100", headers: headers() })).body).data as Array<{ code: string }>;
    const codes = all.map((r) => r.code);
    expect(codes.indexOf("ZZ-1")).toBeLessThan(codes.indexOf("ZZ-2"));
    const p2 = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/locations?limit=1&offset=1", headers: headers() })).body).data as Array<{ code: string }>;
    expect(p2).toHaveLength(1);
    expect(p2[0]?.code).toBe(codes[1]);
  });

  it("audits location create and records the before-image on update", async () => {
    const q = new MemoryQueue();
    registerF3EnterpriseConsumers(q);
    await q.start();
    const id = randomUUID();
    const pub = (payload: Record<string, unknown>) => q.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ml04-aud", schemaVersion: "1.0", payload,
    });
    await pub({ op: "location_create", id, tenantId: TENANT, code: "AUD-1", name: "Before", orgUnit: "Works" });
    await new Promise<void>((r) => setTimeout(r, 400));
    await pub({ op: "location_update", id, tenantId: TENANT, name: "After" });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();
    const out = await sqlClient`select payload from _outbox.messages where tenant_id = ${TENANT} and topic = 'audit.event.record' and payload->>'resourceId' = ${id} order by created_at`;
    expect(out).toHaveLength(2);
    expect((out[0]!.payload as { action: string }).action).toBe("create");
    expect((out[1]!.payload as { details: unknown }).details).toEqual({ name: "After", before: { name: "Before", orgUnit: "Works" } });
  });

  it("rejects an org unit longer than the 64-char column", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/assets/locations", headers: headers(), payload: { code: "X-1", name: "X", orgUnit: "o".repeat(65) } });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH updates name/orgUnit through the consumer but never the code, and 404s on an unknown id", async () => {
    const q = new MemoryQueue();
    registerF3EnterpriseConsumers(q);
    await q.start();
    await q.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ml04-loc", schemaVersion: "1.0",
      payload: { op: "location_update", id: LOC, tenantId: TENANT, name: "Block A (renamed)", orgUnit: "Works" },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();
    const [row] = await asTenant((tx) => tx.select().from(functionalLocations).where(eq(functionalLocations.id, LOC)));
    expect(row).toMatchObject({ code: "BLDG-A", name: "Block A (renamed)", orgUnit: "Works" });

    const ok = await app.inject({ method: "PATCH", url: `/v1/assets/locations/${LOC}`, headers: headers(), payload: { name: "Block A2" } });
    expect(ok.statusCode).toBe(202);
    const empty = await app.inject({ method: "PATCH", url: `/v1/assets/locations/${LOC}`, headers: headers(), payload: {} });
    expect(empty.statusCode).toBe(400);
    const missing = await app.inject({ method: "PATCH", url: `/v1/assets/locations/${randomUUID()}`, headers: headers(), payload: { name: "Z" } });
    expect(missing.statusCode).toBe(404);
  });
});
void sql;
