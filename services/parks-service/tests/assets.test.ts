/**
 * assets module — real DB-backed route -> consumer -> persisted-state
 * coverage, plus regression coverage for the asset_code collision bug
 * (see complaints.test.ts's header for the full shared rationale) and the
 * status-transition-guard regression already fixed on main (routes.ts now
 * calls validateAssetStatusTransition before a PATCH is accepted — this
 * suite re-proves that end to end through the real route + consumer + DB
 * rather than trusting the code comment).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAssetConsumers } from "../src/modules/assets/consumer.js";
import * as repo from "../src/modules/assets/repo.js";
import { authHeader, ADMIN_ROLES, drainQueue } from "./_helpers.js";

const TENANT = "e0000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "e0000000-0000-4000-8000-000000000002";
const ACTOR = "e0000000-0000-4000-8000-0000000000aa";

let app: FastifyInstance;

beforeAll(async () => {
  registerAssetConsumers(queue);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/parks/assets — route -> consumer -> persisted state", () => {
  it("creates an asset: 202, then a real row with a sequence-backed asset_code", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/parks/assets",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { assetType: "playground", name: "Sector 12 playground" },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();

    await drainQueue(queue);

    const row = await repo.findById(id, TENANT);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("active");
    expect(row!.assetCode).toMatch(/^PRKA-\d+$/);
  });

  it("PATCH status closed -> under_maintenance directly is rejected (422) — regression guard for the transition-graph bypass documented in routes.ts", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/assets",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { assetType: "fountain" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const closeRes = await app.inject({
      method: "PATCH",
      url: `/v1/parks/assets/${id}`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { status: "closed", version: 1 },
    });
    expect(closeRes.statusCode).toBe(202);
    await drainQueue(queue);
    expect((await repo.findById(id, TENANT))!.status).toBe("closed");

    const badRes = await app.inject({
      method: "PATCH",
      url: `/v1/parks/assets/${id}`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { status: "under_maintenance", version: 2 },
    });
    expect(badRes.statusCode).toBe(422);
  });

  it("records maintenance and appends to maintenanceHistory", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/parks/assets",
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { assetType: "garden" },
    });
    const { id } = createRes.json();
    await drainQueue(queue);

    const res = await app.inject({
      method: "POST",
      url: `/v1/parks/assets/${id}/maintenance`,
      headers: { ...authHeader(TENANT, ACTOR, ADMIN_ROLES), "content-type": "application/json" },
      payload: { maintenanceEntry: { notes: "Mowed and weeded" }, version: 1 },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue(queue);

    const row = await repo.findById(id, TENANT);
    expect(row!.maintenanceHistory).toHaveLength(1);
    expect((row!.maintenanceHistory as Array<{ notes: string }>)[0]!.notes).toBe("Mowed and weeded");
    expect(row!.lastMaintenanceDate).toBeDefined();
  });
});

describe("asset_code — tenant-scoped UNIQUE constraint", () => {
  async function insertWithCode(tenantId: string, assetCode: string) {
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${tenantId}'`));
      await repo.insert(tx, {
        id, tenantId, assetCode, assetType: "park", name: null,
        location: null, area: null, areaUnit: null, status: "active",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    });
    return id;
  }

  it("rejects a second row for the SAME tenant with a duplicate asset_code", async () => {
    const dupCode = `DUP-${randomUUID().slice(0, 8)}`;
    await insertWithCode(TENANT, dupCode);
    await expect(insertWithCode(TENANT, dupCode)).rejects.toThrow();
  });

  it("allows the SAME asset_code for two DIFFERENT tenants", async () => {
    const sharedCode = `SHARED-${randomUUID().slice(0, 8)}`;
    await expect(insertWithCode(TENANT, sharedCode)).resolves.toBeDefined();
    await expect(insertWithCode(OTHER_TENANT, sharedCode)).resolves.toBeDefined();
  });
});
