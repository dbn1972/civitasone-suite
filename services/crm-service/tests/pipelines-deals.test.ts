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
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import * as dealsRepo from "../src/modules/deals/repo.js";

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

/**
 * SEC (this PR): `deals/repo.ts` and `pipelines/repo.ts` read functions must scope
 * strictly to the AUTHENTICATED tenant (JWT `tid` -> `ctx.tenantId`), never to the
 * client-controllable `x-tenant-id` header. Before this fix these functions used
 * `scopedRead`, whose FORCE-RLS `app.tenant_id` GUC is only set via AsyncLocalStorage
 * populated by `createTenantTxHook`'s onRequest hook -- which reads that header, not
 * `ctx.tenantId`. Empirically (verified directly against the test DB as `crm_svc`),
 * `crm.deals`/`crm.pipelines`/`crm.contacts` are FORCE ROW LEVEL SECURITY and return
 * ZERO rows when `app.tenant_id` is unset -- so a real, header-less request (every
 * `app.inject` call in this suite; the gateway "apparently" doesn't reliably send the
 * header either) silently lost its own tenant's data. `findById`/`listByTenant` (both
 * files) and `dealExists`/`contactExists`/`stageAgeingExceeding`/`kanbanCards`/
 * `funnelBuckets` (deals) now use `tenantTransaction(db, tenantId, ...)` instead, so
 * the GUC is set explicitly from the same verified `tenantId` the app-layer WHERE
 * clause already uses -- matching `gateSnapshot`/`stagesOf`, fixed earlier in this PR.
 *
 * Each "no header" case below is a genuine regression test: it fails against the
 * pre-fix `scopedRead` code (RLS silently returns nothing, so the caller's own
 * just-created row goes missing) and passes only once the read is wired to
 * `tenantTransaction`. Each "mismatched header" case proves the stronger security
 * property the PR asks for: an authenticated tenant cannot be shown a DIFFERENT
 * tenant's data by a spoofed header, AND a bad header can no longer hide the
 * caller's OWN data (the same RLS-GUC bug, triggered by a wrong value instead of a
 * missing one).
 */
describe("SEC: deals/pipelines reads are JWT-tenant-scoped, not x-tenant-id header-scoped", () => {
  const OTHER_TENANT = "aaaaaaaa-1111-4000-8000-0000000000fe";

  it("GET /v1/crm/deals/:id (findById) — returns the caller's own deal with NO x-tenant-id header", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` }, // no x-tenant-id, like every real gateway call per the PR description
      payload: { name: "SEC No-Header FindById", valueMinor: 100000, currency: "INR" },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().id as string;
    await drainQueue();

    const get = await app.inject({
      method: "GET",
      url: `/v1/crm/deals/${id}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().id).toBe(id);
    expect(get.json().name).toBe("SEC No-Header FindById");
  });

  it("GET /v1/crm/deals/:id (findById) — a MISMATCHED x-tenant-id header neither hides the caller's own deal nor leaks it to the other tenant", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "SEC Mismatched-Header FindById", valueMinor: 200000, currency: "INR" },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().id as string;
    await drainQueue();

    // Valid JWT for TENANT, but the header claims a completely different tenant.
    const get = await app.inject({
      method: "GET",
      url: `/v1/crm/deals/${id}`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": OTHER_TENANT },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().id).toBe(id);

    // A caller genuinely authenticated AS the other tenant must never see it —
    // the actual security property: no header value can widen access.
    const asOther = await app.inject({
      method: "GET",
      url: `/v1/crm/deals/${id}`,
      headers: { authorization: `Bearer ${token(OTHER_TENANT)}` },
    });
    expect(asOther.statusCode).toBe(404);
  });

  it("GET /v1/crm/deals (listByTenant) — includes the caller's deal with NO x-tenant-id header", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "SEC No-Header List Deal", valueMinor: 300000, currency: "INR" },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().id as string;
    await drainQueue();

    const list = await app.inject({
      method: "GET",
      url: "/v1/crm/deals?limit=200&offset=0",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(list.statusCode).toBe(200);
    const ids = (list.json().data as Array<{ id: string }>).map((d) => d.id);
    expect(ids).toContain(id);
  });

  it("GET /v1/crm/pipelines/:id (findById) — returns the caller's own pipeline with NO x-tenant-id header", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "SEC No-Header Pipeline", stages: makeStages(3) },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().id as string;
    await drainQueue();

    const get = await app.inject({
      method: "GET",
      url: `/v1/crm/pipelines/${id}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.id).toBe(id);
  });

  it("GET /v1/crm/pipelines/:id (findById) — a MISMATCHED x-tenant-id header neither hides the caller's own pipeline nor leaks it to the other tenant", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "SEC Mismatched-Header Pipeline", stages: makeStages(3) },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().id as string;
    await drainQueue();

    const get = await app.inject({
      method: "GET",
      url: `/v1/crm/pipelines/${id}`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": OTHER_TENANT },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.id).toBe(id);

    const asOther = await app.inject({
      method: "GET",
      url: `/v1/crm/pipelines/${id}`,
      headers: { authorization: `Bearer ${token(OTHER_TENANT)}` },
    });
    expect(asOther.statusCode).toBe(404);
  });

  it("GET /v1/crm/pipelines (listByTenant) — includes the caller's pipeline with NO x-tenant-id header", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "SEC No-Header List Pipeline", stages: makeStages(3) },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().id as string;
    await drainQueue();

    const list = await app.inject({
      method: "GET",
      url: "/v1/crm/pipelines?limit=200&offset=0",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(list.statusCode).toBe(200);
    const ids = (list.json().data as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(id);
  });

  it("GET /v1/crm/deals/kanban and /v1/crm/deals/funnel (kanbanCards/funnelBuckets) — include the caller's deal with NO x-tenant-id header", async () => {
    const pipeline = await app.inject({
      method: "POST",
      url: "/v1/crm/pipelines",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "SEC Kanban/Funnel Pipeline", stages: makeStages(3) },
    });
    const pipelineId = pipeline.json().id as string;
    await drainQueue();

    const deal = await app.inject({
      method: "POST",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "SEC Kanban Deal", pipelineId, valueMinor: 400000, currency: "INR" },
    });
    expect(deal.statusCode).toBe(202);
    const dealId = deal.json().id as string;
    await drainQueue();

    const kanban = await app.inject({
      method: "GET",
      url: "/v1/crm/deals/kanban",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(kanban.statusCode).toBe(200);
    const kanbanIds = (kanban.json().data as Array<{ cards: Array<{ id: string }> }>).flatMap((col) => col.cards.map((c) => c.id));
    expect(kanbanIds).toContain(dealId);

    const funnel = await app.inject({
      method: "GET",
      url: "/v1/crm/deals/funnel",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(funnel.statusCode).toBe(200);
    const funnelTotal = (funnel.json().data as Array<{ count: number }>).reduce((sum, b) => sum + b.count, 0);
    expect(funnelTotal).toBeGreaterThan(0);
  });

  /**
   * `dealExists`/`contactExists`/`stageAgeingExceeding` have no HTTP entry point of
   * their own (the first two are called from queue consumers with a message-payload
   * tenantId; ageing is HTTP-reachable but exercising it end-to-end needs a whole
   * stage-limit config + an aged row). Testing at the repo layer directly against
   * AsyncLocalStorage exercises the exact mechanism the fix changes, with no HTTP
   * detour needed: `runWithTenant` here stands in for what `createTenantTxHook` would
   * populate from a header (present-but-empty == "no header"; present-with-OTHER ==
   * "mismatched header").
   */
  it("dealExists/contactExists/stageAgeingExceeding (repo layer) — resolve by the explicit tenantId param, ignoring AsyncLocalStorage entirely", async () => {
    const dealId = randomUUID();
    const contactId = randomUUID();

    async function seed(tenantId: string): Promise<void> {
      await sqlClient.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        await tx`
          INSERT INTO crm.contacts (id, tenant_id, name, created_by, updated_by)
          VALUES (${contactId}, ${tenantId}, 'SEC Repo Contact', ${ACTOR}, ${ACTOR})
          ON CONFLICT (id) DO NOTHING`;
        await tx`
          INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, stage_entered_at, created_by, updated_by, version)
          VALUES (${dealId}, ${tenantId}, 'SEC Repo Deal', 'Lead', 50000, 'INR', 'active', now() - interval '90 days', ${ACTOR}, ${ACTOR}, 1)
          ON CONFLICT (id) DO NOTHING`;
        await tx`
          INSERT INTO crm.stage_limits (id, tenant_id, stage, max_days, enabled, created_by, updated_by)
          VALUES (${randomUUID()}, ${tenantId}, 'Lead', 30, true, ${ACTOR}, ${ACTOR})
          ON CONFLICT DO NOTHING`;
      });
    }
    await seed(TENANT);

    // No tenant context in AsyncLocalStorage at all — the "header never arrived" case.
    // Pre-fix (`scopedRead`), the FORCE-RLS GUC would stay unset and these would
    // silently report "not found" / empty even for TENANT's own rows.
    expect(await dealsRepo.dealExists(TENANT, dealId)).toBe(true);
    expect(await dealsRepo.contactExists(TENANT, contactId)).toBe(true);
    const ageing = await dealsRepo.stageAgeingExceeding(TENANT);
    expect(ageing.map((r) => r.id)).toContain(dealId);

    // AsyncLocalStorage actively holds a DIFFERENT tenant (the "mismatched header"
    // case) while the explicit, verified tenantId argument is still TENANT. The
    // explicit argument must win: TENANT's own row is still found ...
    await runWithTenant(OTHER_TENANT, async () => {
      expect(await dealsRepo.dealExists(TENANT, dealId)).toBe(true);
      expect(await dealsRepo.contactExists(TENANT, contactId)).toBe(true);
      const ageingUnderMismatch = await dealsRepo.stageAgeingExceeding(TENANT);
      expect(ageingUnderMismatch.map((r) => r.id)).toContain(dealId);

      // ... and querying AS the mismatched tenant for the SAME ids never finds
      // TENANT's rows — the actual no-leak property, proven with the GUC now
      // demonstrably live (not just inert/no-op as it was pre-fix).
      expect(await dealsRepo.dealExists(OTHER_TENANT, dealId)).toBe(false);
      expect(await dealsRepo.contactExists(OTHER_TENANT, contactId)).toBe(false);
    });
  });
});
