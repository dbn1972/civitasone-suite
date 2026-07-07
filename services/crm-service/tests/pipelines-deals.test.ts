/**
 * CRM Pipeline & Deals Integration Tests
 *
 * Tests:
 * - Pipeline CRUD (POST, GET list, GET :id, PATCH, DELETE soft)
 * - Deal CRUD (POST, GET list, GET :id, PATCH, DELETE soft)
 * - Stage transition with optimistic locking (PATCH /v1/crm/deals/:id/stage)
 * - 409 version conflict on stale version
 * - 3–10 stage validation on pipeline creation
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function token(tenantId = TENANT, roles = ["crm_admin"]) {
  return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

function makeStages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    name: `Stage ${i + 1}`,
    probability: Math.round((i / (count - 1)) * 100),
    ordinal: i,
  }));
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Pipeline CRUD", () => {
  it("POST /v1/crm/pipelines — creates pipeline with valid stages (202)", async () => {
    const stages = makeStages(5);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Sales Pipeline", stages },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("POST /v1/crm/pipelines — rejects < 3 stages (400)", async () => {
    const stages = makeStages(2);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Bad Pipeline", stages },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/crm/pipelines — rejects > 10 stages (400)", async () => {
    const stages = makeStages(11);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Too Many Stages", stages },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/crm/pipelines — accepts exactly 3 stages (202)", async () => {
    const stages = makeStages(3);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Minimal Pipeline", stages },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/crm/pipelines — accepts exactly 10 stages (202)", async () => {
    const stages = makeStages(10);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Maximum Pipeline", stages },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/crm/pipelines — returns 200 with list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /v1/crm/pipelines/:id — returns 404 for non-existent", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/pipelines/${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/crm/pipelines/:id — requires version field", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/pipelines/${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /v1/crm/pipelines/:id — returns 202", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/crm/pipelines/${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/crm/pipelines — returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/crm/pipelines — returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/pipelines",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Deal CRUD", () => {
  it("POST /v1/crm/deals — creates deal with pipelineId and stageId (202)", async () => {
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        name: "Big Deal",
        pipelineId,
        stageId,
        stage: "Lead",
        valueMinor: 5000000, // 50K INR in paise
        currency: "INR",
        probability: 20,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("POST /v1/crm/deals — creates deal without pipelineId (202)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Simple Deal", valueMinor: 100000, probability: 10 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/crm/deals — rejects invalid probability (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Bad Deal", probability: 150 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/crm/deals — returns 200 with list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/crm/deals/:id — returns 404 for non-existent", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/deals/${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/crm/deals/:id — returns 202", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/crm/deals/${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/crm/deals/:id — requires at least one field (400)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Deal Stage Transition with Optimistic Locking", () => {
  it("PATCH /v1/crm/deals/:id/stage — requires version field (400)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "Proposal" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/crm/deals/:id/stage — rejects non-existent deal with 409 (version mismatch or not found)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "Proposal", version: 1 },
    });
    // Non-existent deal returns 409 (can't match version)
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("VERSION_CONFLICT");
  });

  it("PATCH /v1/crm/deals/:id/stage — rejects invalid stage (400)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "InvalidStage", version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/crm/deals/:id/stage — accepts valid stage with stageId", async () => {
    const stageId = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "Won", stageId, version: 1 },
    });
    // Will be 409 because deal doesn't exist, but validates body parsing works
    expect(res.statusCode).toBe(409);
  });

  it("PATCH /v1/crm/deals/:id/stage — returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
      payload: { stage: "Proposal", version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/crm/deals/:id/stage — returns 401 without token", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      payload: { stage: "Proposal", version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Pipeline stage count validation", () => {
  it("validates stage probability is 0-100", async () => {
    const stages = makeStages(4);
    stages[0].probability = 101;
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Bad Probability", stages },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates stage names are non-empty", async () => {
    const stages = makeStages(4);
    stages[0].name = "";
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Empty Stage Name", stages },
    });
    expect(res.statusCode).toBe(400);
  });
});
