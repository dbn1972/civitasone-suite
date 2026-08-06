/**
 * G17 — Due-horizon work-queue generator route tests.
 *
 * Tests the HTTP endpoints for config CRUD, sweep trigger, and run listing.
 * Covers: happy path, 400 validation, 401 auth, 403 forbidden, 404 not found.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000g17a0001";
const ACTOR = "cccccccc-3333-4000-8000-0000g17a0002";
const CONFIG_ID = "dddddddd-4444-4000-8000-0000g17a0003";
const RUN_ID = "eeeeeeee-5555-4000-8000-0000g17a0004";

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.due_horizon_runs WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.due_horizon_configs WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

async function seedConfig() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`INSERT INTO crm.due_horizon_configs (id, tenant_id, name, horizons, group_by, consent_required, active, created_by)
      VALUES (${CONFIG_ID}, ${TENANT}, 'Standard Maturity', '[60, 30, 7]'::jsonb, 'product', true, true, ${ACTOR})
      ON CONFLICT (id) DO NOTHING`;
  });
}

async function seedRun() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`INSERT INTO crm.due_horizon_runs (id, tenant_id, config_id, horizon_days, items_generated, status)
      VALUES (${RUN_ID}, ${TENANT}, ${CONFIG_ID}, 30, 15, 'completed')
      ON CONFLICT (id) DO NOTHING`;
  });
}

beforeAll(async () => {
  await cleanup();
  await seedConfig();
  await seedRun();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GET /v1/crm/due-horizon-configs", () => {
  it("lists configs for the tenant (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/due-horizon-configs",
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toHaveProperty("pageSize");
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/due-horizon-configs",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/due-horizon-configs",
      headers: headers(["finance_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/crm/due-horizon-configs", () => {
  it("accepts valid config creation (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/due-horizon-configs",
      headers: headers(),
      payload: { name: "Quarterly Sweep", horizons: [90, 60, 30], groupBy: "region" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.status).toBe("accepted");
    expect(body.data.id).toBeDefined();
  });

  it("returns 400 for missing name", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/due-horizon-configs",
      headers: headers(),
      payload: { horizons: [30] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid groupBy value", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/due-horizon-configs",
      headers: headers(),
      payload: { name: "Bad", groupBy: "invalid" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for horizon > 365", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/due-horizon-configs",
      headers: headers(),
      payload: { name: "Too Far", horizons: [400] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for crm_user trying to create", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/due-horizon-configs",
      headers: headers(["crm_user"]),
      payload: { name: "Blocked", horizons: [30] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/due-horizon-configs",
      payload: { name: "No Auth" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/crm/due-horizon-configs/:id", () => {
  it("accepts valid patch (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/due-horizon-configs/${CONFIG_ID}`,
      headers: headers(),
      payload: { name: "Updated Name", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.status).toBe("accepted");
  });

  it("returns 404 for non-existent config", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/crm/due-horizon-configs/00000000-0000-4000-8000-000000000000",
      headers: headers(),
      payload: { name: "Ghost", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for missing version", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/due-horizon-configs/${CONFIG_ID}`,
      headers: headers(),
      payload: { name: "No version" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for crm_user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/due-horizon-configs/${CONFIG_ID}`,
      headers: headers(["crm_user"]),
      payload: { name: "Blocked", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/crm/due-horizon-configs/:id/run", () => {
  it("triggers a sweep run (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/due-horizon-configs/${CONFIG_ID}/run`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.status).toBe("accepted");
  });

  it("returns 404 for non-existent config", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/due-horizon-configs/00000000-0000-4000-8000-000000000000/run",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 422 for inactive config", async () => {
    // Deactivate the config directly
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`UPDATE crm.due_horizon_configs SET active = false WHERE id = ${CONFIG_ID}`;
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/due-horizon-configs/${CONFIG_ID}/run`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(422);

    // Restore
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`UPDATE crm.due_horizon_configs SET active = true WHERE id = ${CONFIG_ID}`;
    });
  });

  it("returns 403 for crm_user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/due-horizon-configs/${CONFIG_ID}/run`,
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/due-horizon-runs", () => {
  it("lists runs for the tenant (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/due-horizon-runs",
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toHaveProperty("pageSize");
  });

  it("filters runs by configId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/due-horizon-runs?configId=${CONFIG_ID}`,
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.every((r: { configId: string }) => r.configId === CONFIG_ID)).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/due-horizon-runs",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/due-horizon-runs",
      headers: headers(["finance_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
