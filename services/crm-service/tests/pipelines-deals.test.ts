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
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
// Must be a real UUID, not a placeholder like "user-001": every write projects this
// into created_by/updated_by (uuid columns), so a non-UUID sub silently fails every
// consumer write to the DLQ ("invalid input syntax for type uuid") while the route's
// synchronous 202 still returns fine — which is exactly why this went unnoticed: no
// test in this file previously drained the queue to check post-consumer DB state.
const ACTOR = "bbbbbbbb-1111-4000-8000-000000000099";

function token(tenantId = TENANT, roles = ["crm_admin"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET);
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
  // Needed so the stage_id-persistence assertion below can drain the real
  // route -> bus -> consumer path (repo.insert) rather than only checking the
  // synchronous 202 envelope. Registering all consumers + starting the queue
  // is a no-op for every other test in this file — none of them assert on
  // post-consumer DB state (they use random, non-existent ids), matching the
  // same pattern already established in deal-close.test.ts.
  registerAllConsumers(queue);
  await queue.start();
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
  it("POST /v1/crm/deals — creates deal with pipelineId and stageId (202), persists the RESOLVED stage's own id, not a mismatched stageId", async () => {
    // Two real, distinct stages (created via the actual pipeline-create path, so their
    // ids are genuine) so a mismatched stageId (pointing at "Won") is distinguishable
    // from the correctly resolved one (the deal's own requested stage, "Lead").
    const leadStageId = randomUUID();
    const wonStageId = randomUUID();
    const pipelineRes = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        name: "Stage-id Sync Test Pipeline",
        stages: [
          { id: leadStageId, name: "Lead", probability: 10, ordinal: 0 },
          { id: wonStageId, name: "Won", probability: 100, ordinal: 1 },
          { id: randomUUID(), name: "Lost", probability: 0, ordinal: 2 },
        ],
      },
    });
    expect(pipelineRes.statusCode).toBe(202);
    const pipelineId = pipelineRes.json().id;
    await drainQueue();

    // Same exploit shape as the PATCH /stage and close bugs: stage="Lead" (the
    // deal's real, intended stage) but stageId points at an unrelated stage ("Won").
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        name: "Big Deal",
        pipelineId,
        stageId: wonStageId,
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

    await drainQueue();
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ stage: string; stageId: string | null }>>`
        SELECT stage, stage_id AS "stageId" FROM crm.deals WHERE id = ${body.id} AND tenant_id = ${TENANT}
      `;
    });
    expect(rows[0]?.stage).toBe("Lead");
    // The RESOLVED Lead stage's own id — never the raw, mismatched stageId (Won's id)
    // the request carried. This is the same bug class already fixed for PATCH /stage
    // and close; this assertion is what would catch it regressing via deal creation.
    expect(rows[0]?.stageId).toBe(leadStageId);
    expect(rows[0]?.stageId).not.toBe(wonStageId);
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

  it("PATCH /v1/crm/deals/:id/stage — enqueues CQRS command (202)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "Proposal", version: 1 },
    });
    // Version conflict is applied asynchronously by the consumer
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("PATCH /v1/crm/deals/:id/stage — rejects empty stage (400) — still a required, real value", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "", version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  // OP-002: `stage` is no longer a fixed 5-value enum (validators.ts's old
  // z.enum(["Lead","Proposal","Negotiation","Won","Lost"])) — a non-legacy name is only
  // rejected when it doesn't match the deal's OWN pipeline's configured stages. This deal
  // has no pipelineId (random, non-existent id — gateSnapshot finds nothing), so there is
  // no pipeline to validate the name against and the request is accepted, same as the
  // adjacent "Proposal" case below.
  it("PATCH /v1/crm/deals/:id/stage — accepts a non-legacy stage name when no pipeline is scoped (202)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "InvalidStage", version: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/crm/deals/:id/stage — accepts valid stage with stageId → 202", async () => {
    const stageId = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${randomUUID()}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "Won", stageId, version: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
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

describe("OP-002: dynamic per-pipeline stage validation (deals no longer bound to a fixed 5-value enum)", () => {
  async function createCustomPipeline() {
    const intakeId = randomUUID();
    const siteVisitId = randomUUID();
    const wonId = randomUUID();
    const lostId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        name: "Field Services Pipeline",
        stages: [
          { id: intakeId, name: "Intake", probability: 10, ordinal: 0 },
          { id: siteVisitId, name: "Site Visit Scheduled", probability: 40, ordinal: 1 },
          { id: wonId, name: "Won", probability: 100, ordinal: 2 },
          { id: lostId, name: "Lost", probability: 0, ordinal: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    return { pipelineId: res.json().id as string, intakeId, siteVisitId, wonId, lostId };
  }

  it("POST /v1/crm/deals — creates a deal directly into a custom (non-legacy) pipeline stage (202), persists stage + real stageId", async () => {
    const { pipelineId, siteVisitId } = await createCustomPipeline();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Custom-stage deal", pipelineId, stage: "Site Visit Scheduled", valueMinor: 10000 },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ stage: string; stageId: string | null }>>`
        SELECT stage, stage_id AS "stageId" FROM crm.deals WHERE id = ${res.json().id} AND tenant_id = ${TENANT}
      `;
    });
    expect(rows[0]?.stage).toBe("Site Visit Scheduled");
    expect(rows[0]?.stageId).toBe(siteVisitId);
  });

  it('POST /v1/crm/deals — omitting stage on a pipeline-scoped deal lands on THAT pipeline\'s own entry stage, not the literal "Lead" (202)', async () => {
    const { pipelineId, intakeId } = await createCustomPipeline();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "No stage specified", pipelineId, valueMinor: 5000 },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ stage: string; stageId: string | null }>>`
        SELECT stage, stage_id AS "stageId" FROM crm.deals WHERE id = ${res.json().id} AND tenant_id = ${TENANT}
      `;
    });
    expect(rows[0]?.stage).toBe("Intake");
    expect(rows[0]?.stageId).toBe(intakeId);
  });

  it("PATCH /v1/crm/deals/:id/stage — moves a deal into a custom pipeline's own stage (202), persists the resolved stage + stageId", async () => {
    const { pipelineId, siteVisitId } = await createCustomPipeline();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Move me", pipelineId, stage: "Intake", valueMinor: 20000 },
    });
    expect(createRes.statusCode).toBe(202);
    await drainQueue();
    const dealId = createRes.json().id as string;

    const moveRes = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${dealId}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "Site Visit Scheduled", version: 1 },
    });
    expect(moveRes.statusCode).toBe(202);
    await drainQueue();

    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ stage: string; stageId: string | null; status: string }>>`
        SELECT stage, stage_id AS "stageId", status FROM crm.deals WHERE id = ${dealId} AND tenant_id = ${TENANT}
      `;
    });
    expect(rows[0]?.stage).toBe("Site Visit Scheduled");
    expect(rows[0]?.stageId).toBe(siteVisitId);
    expect(rows[0]?.status).toBe("active");
  });

  it("PATCH /v1/crm/deals/:id/stage — rejects a stage name that isn't one of THIS deal's pipeline stages (422 INVALID_STAGE), leaves the row untouched", async () => {
    const { pipelineId } = await createCustomPipeline();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Should not move", pipelineId, stage: "Intake", valueMinor: 20000 },
    });
    expect(createRes.statusCode).toBe(202);
    await drainQueue();
    const dealId = createRes.json().id as string;

    const moveRes = await app.inject({
      method: "PATCH",
      url: `/v1/crm/deals/${dealId}/stage`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "Not A Real Stage", version: 1 },
    });
    expect(moveRes.statusCode).toBe(422);
    expect(moveRes.json().code).toBe("INVALID_STAGE");

    // The write must never have reached the consumer — confirm the row is untouched.
    await drainQueue();
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ stage: string }>>`SELECT stage FROM crm.deals WHERE id = ${dealId} AND tenant_id = ${TENANT}`;
    });
    expect(rows[0]?.stage).toBe("Intake");
  });

  it("POST /v1/crm/deals — rejects a stage name that isn't one of the given pipeline's stages (422 INVALID_STAGE)", async () => {
    const { pipelineId } = await createCustomPipeline();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Bad stage on create", pipelineId, stage: "Not A Real Stage", valueMinor: 1000 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STAGE");
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
