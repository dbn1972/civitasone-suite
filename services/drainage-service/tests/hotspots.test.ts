/**
 * Route -> command -> real consumer -> persisted-state coverage for the
 * hotspots module.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerHotspotConsumers } from "../src/modules/hotspots/consumer.js";
import { hdr, waitFor, ADMIN_ROLES, USER_ROLES, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerHotspotConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const hotspotBody = {
  location: { ward: "3" },
  category: "chronic_blockage",
  complaintCount: 4,
  riskScore: 55,
};

async function identifyAndWait(body: Record<string, unknown> = hotspotBody): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/drainage/hotspots", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: body });
  expect(create.statusCode).toBe(202);
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).statusCode === 200);
  return id;
}

describe("POST /v1/drainage/hotspots", () => {
  it("identifies a hotspot and persists it with a unique hotspotCode", async () => {
    const id = await identifyAndWait();
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.status).toBe("identified");
    expect(row.version).toBe(1);
    expect(row.complaintCount).toBe(4);
    expect(row.riskScore).toBe(55);
    expect(row.hotspotCode).toMatch(/^DRNH-\d+-\d{4}$/);
  });

  it("requires ADMIN_ROLES to identify a hotspot", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/drainage/hotspots", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES), payload: hotspotBody });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a riskScore outside 0-100 with a 400 before publishing", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/drainage/hotspots", headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { ...hotspotBody, riskScore: 150 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("hotspot lifecycle: status transitions + resolve", () => {
  it("moves identified -> action_planned -> work_in_progress -> resolved, bumping version each step", async () => {
    const id = await identifyAndWait();
    let row = (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;

    const plan = await app.inject({ method: "POST", url: `/v1/drainage/hotspots/${id}/status`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { status: "action_planned", maintenancePlanRef: "PLAN-1", version: row.version } });
    expect(plan.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "action_planned");
    row = (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.maintenancePlanRef).toBe("PLAN-1");
    expect(row.version).toBe(2);

    const wip = await app.inject({ method: "POST", url: `/v1/drainage/hotspots/${id}/status`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { status: "work_in_progress", version: row.version } });
    expect(wip.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "work_in_progress");
    row = (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;

    const resolve = await app.inject({ method: "POST", url: `/v1/drainage/hotspots/${id}/resolve`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { version: row.version } });
    expect(resolve.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data.status === "resolved");
    row = (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.version).toBe(4);
  });

  it("rejects an invalid transition (identified -> work_in_progress, skipping action_planned) with 422", async () => {
    const id = await identifyAndWait();
    const res = await app.inject({ method: "POST", url: `/v1/drainage/hotspots/${id}/status`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { status: "work_in_progress", version: 1 } });
    expect(res.statusCode).toBe(422);
  });

  it("rejects a stale version with 409 and leaves the row untouched", async () => {
    const id = await identifyAndWait();
    const res = await app.inject({ method: "POST", url: `/v1/drainage/hotspots/${id}/status`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES), payload: { status: "action_planned", version: 7 } });
    expect(res.statusCode).toBe(409);
    const row = (await app.inject({ method: "GET", url: `/v1/drainage/hotspots/${id}`, headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) })).json().data;
    expect(row.status).toBe("identified");
    expect(row.version).toBe(1);
  });
});

describe("GET /v1/drainage/hotspots", () => {
  it("lists hotspots for the tenant ordered by riskScore, filterable by status", async () => {
    await identifyAndWait({ ...hotspotBody, riskScore: 10 });
    await identifyAndWait({ ...hotspotBody, riskScore: 90 });
    const res = await app.inject({ method: "GET", url: "/v1/drainage/hotspots?status=identified&limit=50", headers: hdr(ACTOR_A, TENANT_A, USER_ROLES) });
    expect(res.statusCode).toBe(200);
    const scores = res.json().data.map((h: { riskScore: number }) => h.riskScore);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
  });
});
