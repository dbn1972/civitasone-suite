/**
 * Opportunity / pipeline HTTP -> consumer -> DB tests (OP-002..006, OP-004).
 * Covers pipeline scope + per-stage mandatory fields, stage-gate enforcement,
 * stage-limit config + ageing dashboard, kanban/funnel, and extended closure.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-0000000000a1";
const OTHER = "aaaaaaaa-2222-4000-8000-0000000000a2";
const ACTOR = "cccccccc-2222-4000-8000-0000000000a1";

function headers(roles = ["crm_admin"], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s-op" }, SECRET)}`, "x-tenant-id": tenant };
}

const PIPE_ID = "bbbbbbbb-2222-4000-8000-000000000001";
const STAGE_LEAD = "dddddddd-2222-4000-8000-000000000001";
const STAGE_NEG = "dddddddd-2222-4000-8000-000000000002";
const STAGE_WON = "dddddddd-2222-4000-8000-000000000003";

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>, tenant = TENANT): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await scoped((tx) => tx`DELETE FROM crm.deals WHERE tenant_id = ${t}`.then(() => 0), t).catch(() => {});
    await scoped((tx) => tx`DELETE FROM crm.pipelines WHERE tenant_id = ${t}`.then(() => 0), t).catch(() => {});
    await scoped((tx) => tx`DELETE FROM crm.stage_limits WHERE tenant_id = ${t}`.then(() => 0), t).catch(() => {});
    await scoped((tx) => tx`DELETE FROM crm.deal_close_policy WHERE tenant_id = ${t}`.then(() => 0), t).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
  // A pipeline scoped to a product/region/BU, with a mandatory-field gate on Negotiation.
  await scoped((tx) => tx`
    INSERT INTO crm.pipelines (id, tenant_id, name, stages, product, region, business_unit, status, created_by, updated_by)
    VALUES (${PIPE_ID}, ${TENANT}, 'Enterprise', ${JSON.stringify([
      { id: STAGE_LEAD, name: "Lead", probability: 10, ordinal: 0 },
      { id: STAGE_NEG, name: "Negotiation", probability: 60, ordinal: 1, mandatoryFields: ["product", "next_step"] },
      { id: STAGE_WON, name: "Won", probability: 100, ordinal: 2 },
    ])}::jsonb, 'CloudSuite', 'South', 'Public Sector', 'active', ${ACTOR}, ${ACTOR})
  `.then(() => 0));
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("OP-002 pipeline scope + list filter", () => {
  it("lists a pipeline filtered by product scope and exposes its scope columns", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/pipelines?product=CloudSuite&region=South", headers: headers(["crm_user"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    const found = res.json().data.find((p: { id: string }) => p.id === PIPE_ID);
    expect(found).toBeTruthy();
    expect(found.product).toBe("CloudSuite");
    expect(found.businessUnit).toBe("Public Sector");
  });
});

describe("OP-003 stage-gate enforcement", () => {
  it("blocks progression into a stage with unmet mandatory fields (422)", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/deals", headers: headers(),
      payload: { name: "Gap Deal", pipelineId: PIPE_ID, stage: "Lead", stageId: STAGE_LEAD, valueMinor: 100000 },
    });
    const dealId = create.json().id;
    await drainQueue();

    const move = await app.inject({
      method: "PATCH", url: `/v1/crm/deals/${dealId}/stage`, headers: headers(),
      payload: { stage: "Negotiation", stageId: STAGE_NEG, version: 1 },
    });
    await app.close();
    expect(move.statusCode).toBe(422);
    expect(move.json().code).toBe("MANDATORY_STAGE_FIELDS_MISSING");
  });

  it("blocks CREATE directly into a gated stage with mandatory fields unset (422)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/crm/deals", headers: headers(),
      payload: { name: "Born Gated", pipelineId: PIPE_ID, stage: "Negotiation", stageId: STAGE_NEG, valueMinor: 100000 },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MANDATORY_STAGE_FIELDS_MISSING");
  });

  it("allows CREATE into a gated stage once the mandatory fields are supplied (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/crm/deals", headers: headers(),
      payload: { name: "Born Complete", pipelineId: PIPE_ID, stage: "Negotiation", stageId: STAGE_NEG, valueMinor: 100000, product: "CloudSuite", nextStep: "Kickoff" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("allows CREATE into the entry stage without mandatory fields (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/crm/deals", headers: headers(),
      payload: { name: "Entry OK", pipelineId: PIPE_ID, stage: "Lead", stageId: STAGE_LEAD, valueMinor: 100000 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("allows progression once the mandatory fields are populated (202) and stamps stage_entered_at", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/deals", headers: headers(),
      payload: { name: "Complete Deal", pipelineId: PIPE_ID, stage: "Lead", stageId: STAGE_LEAD, valueMinor: 200000, product: "CloudSuite", nextStep: "Send SOW" },
    });
    const dealId = create.json().id;
    await drainQueue();

    const move = await app.inject({
      method: "PATCH", url: `/v1/crm/deals/${dealId}/stage`, headers: headers(),
      payload: { stage: "Negotiation", stageId: STAGE_NEG, version: 1 },
    });
    await app.close();
    expect(move.statusCode).toBe(202);
    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{ stage: string; stageEnteredAt: Date | null }>>`
      SELECT stage, stage_entered_at AS "stageEnteredAt" FROM crm.deals WHERE id = ${dealId} AND tenant_id = ${TENANT}`);
    expect(rows[0]!.stage).toBe("Negotiation");
    expect(rows[0]!.stageEnteredAt).not.toBeNull();
  });
});

describe("OP-005 stage-limits config + ageing dashboard", () => {
  const AGED = "eeeeeeee-2222-4000-8000-000000000001";
  it("configures a limit, flags an over-limit deal, then clears it on delete", async () => {
    const app = await buildApp();
    // Configure a 1-day limit on Negotiation.
    const put = await app.inject({
      method: "PUT", url: "/v1/crm/stage-limits", headers: headers(),
      payload: { stage: "Negotiation", maxDays: 1 },
    });
    expect(put.statusCode).toBe(202);
    await drainQueue();

    const list = await app.inject({ method: "GET", url: "/v1/crm/stage-limits", headers: headers() });
    const limit = list.json().data.find((l: { stage: string }) => l.stage === "Negotiation");
    expect(limit.maxDays).toBe(1);

    // Seed a deal that entered Negotiation 10 days ago.
    await scoped((tx) => tx`
      INSERT INTO crm.deals (id, tenant_id, pipeline_id, name, stage, value_minor, currency, status, stage_entered_at, created_by, updated_by, version)
      VALUES (${AGED}, ${TENANT}, ${PIPE_ID}, 'Stalled', 'Negotiation', 500000, 'INR', 'active', now() - interval '10 days', ${ACTOR}, ${ACTOR}, 1)
      ON CONFLICT (id) DO NOTHING`.then(() => 0));

    const ageing = await app.inject({ method: "GET", url: "/v1/crm/deals/stage-ageing", headers: headers(["crm_user"]) });
    expect(ageing.statusCode).toBe(200);
    const row = ageing.json().data.find((r: { id: string }) => r.id === AGED);
    expect(row).toBeTruthy();
    expect(row.daysInStage).toBeGreaterThanOrEqual(9);
    expect(row.daysOverLimit).toBeGreaterThanOrEqual(8);

    // Delete the limit; the dashboard no longer flags the deal.
    const del = await app.inject({ method: "DELETE", url: `/v1/crm/stage-limits/${limit.id}`, headers: headers() });
    expect(del.statusCode).toBe(202);
    await drainQueue();
    const after = await app.inject({ method: "GET", url: "/v1/crm/deals/stage-ageing", headers: headers(["crm_user"]) });
    await app.close();
    expect(after.json().data.find((r: { id: string }) => r.id === AGED)).toBeUndefined();
  });
});

describe("OP-004 kanban + funnel", () => {
  it("groups deals by stage (kanban) and aggregates count/value (funnel)", async () => {
    const app = await buildApp();
    const kanban = await app.inject({ method: "GET", url: `/v1/crm/deals/kanban?pipelineId=${PIPE_ID}`, headers: headers(["crm_user"]) });
    expect(kanban.statusCode).toBe(200);
    expect(Array.isArray(kanban.json().data)).toBe(true);
    const funnel = await app.inject({ method: "GET", url: `/v1/crm/deals/funnel?pipelineId=${PIPE_ID}`, headers: headers(["crm_user"]) });
    await app.close();
    expect(funnel.statusCode).toBe(200);
    const buckets = funnel.json().data as Array<{ stage: string; count: number; totalValueMinor: string }>;
    expect(buckets.length).toBeGreaterThan(0);
    // totalValueMinor is a paise string, never a float.
    for (const b of buckets) expect(/^\d+$/.test(b.totalValueMinor)).toBe(true);
  });
});

describe("OP-006 extended closure", () => {
  const OPEN1 = "ffffffff-2222-4000-8000-000000000001";
  const OPEN2 = "ffffffff-2222-4000-8000-000000000002";
  const OPEN3 = "ffffffff-2222-4000-8000-000000000003";
  const OPEN4 = "ffffffff-2222-4000-8000-000000000004";
  beforeAll(async () => {
    await scoped((tx) => tx`
      INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, stage_entered_at, created_by, updated_by, version)
      VALUES
        (${OPEN1}, ${TENANT}, 'Cancel Me', 'Negotiation', 100000, 'INR', 'active', now(), ${ACTOR}, ${ACTOR}, 1),
        (${OPEN2}, ${TENANT}, 'Hold Me', 'Negotiation', 100000, 'INR', 'active', now(), ${ACTOR}, ${ACTOR}, 1),
        (${OPEN3}, ${TENANT}, 'Lose Me', 'Negotiation', 100000, 'INR', 'active', now(), ${ACTOR}, ${ACTOR}, 1),
        (${OPEN4}, ${TENANT}, 'Lose Me2', 'Negotiation', 100000, 'INR', 'active', now(), ${ACTOR}, ${ACTOR}, 1)
      ON CONFLICT (id) DO NOTHING`.then(() => 0));
  });

  it("rejects cancelled/on_hold without a reason (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/crm/deals/${OPEN1}/close`, headers: headers(), payload: { outcome: "cancelled", reason: "" } });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("REASON_REQUIRED");
  });

  it("closes as cancelled (status='closed', outcome='cancelled') and STAYS visible in GET + funnel", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/crm/deals/${OPEN1}/close`, headers: headers(), payload: { outcome: "cancelled", reason: "Procurement withdrawn by department" } });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const rows = await scoped((tx) => tx<Array<{ stage: string; status: string; closeOutcome: string | null; closeReason: string | null }>>`
      SELECT stage, status, close_outcome AS "closeOutcome", close_reason AS "closeReason" FROM crm.deals WHERE id = ${OPEN1} AND tenant_id = ${TENANT}`);
    // A cancelled CLOSURE must not collide with the soft-delete marker ('cancelled').
    expect(rows[0]!.closeOutcome).toBe("cancelled");
    expect(rows[0]!.status).toBe("closed");
    expect(rows[0]!.stage).toBe("Negotiation");

    // Reporting visibility: the cancelled-closed deal is still returned by GET and funnel.
    const get = await app.inject({ method: "GET", url: `/v1/crm/deals/${OPEN1}`, headers: headers(["crm_user"]) });
    expect(get.statusCode).toBe(200);
    expect(get.json().closeOutcome).toBe("cancelled");
    const funnel = await app.inject({ method: "GET", url: `/v1/crm/deals/funnel`, headers: headers(["crm_user"]) });
    await app.close();
    const stages = (funnel.json().data as Array<{ stage: string }>).map((b) => b.stage);
    expect(stages).toContain("Negotiation"); // OPEN1 still counted
  });

  it("a genuine soft-delete (DELETE) stays hidden from GET", async () => {
    const DEL_ID = "ffffffff-2222-4000-8000-00000000000d";
    await scoped((tx) => tx`
      INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, stage_entered_at, created_by, updated_by, version)
      VALUES (${DEL_ID}, ${TENANT}, 'Delete Me', 'Negotiation', 100000, 'INR', 'active', now(), ${ACTOR}, ${ACTOR}, 1)
      ON CONFLICT (id) DO NOTHING`.then(() => 0));
    const app = await buildApp();
    const del = await app.inject({ method: "DELETE", url: `/v1/crm/deals/${DEL_ID}`, headers: headers() });
    expect(del.statusCode).toBe(202);
    await drainQueue();
    const get = await app.inject({ method: "GET", url: `/v1/crm/deals/${DEL_ID}`, headers: headers(["crm_user"]) });
    await app.close();
    expect(get.statusCode).toBe(404);
  });

  it("closes as on_hold and keeps the deal visible with close_outcome on_hold", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/crm/deals/${OPEN2}/close`, headers: headers(), payload: { outcome: "on_hold", reason: "Awaiting budget approval next quarter" } });
    await app.close();
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const rows = await scoped((tx) => tx<Array<{ status: string; closeOutcome: string | null }>>`
      SELECT status, close_outcome AS "closeOutcome" FROM crm.deals WHERE id = ${OPEN2} AND tenant_id = ${TENANT}`);
    expect(rows[0]!.closeOutcome).toBe("on_hold");
    expect(rows[0]!.status).toBe("on_hold");
  });

  it("enforces competitor-on-loss when the tenant policy requires it", async () => {
    const app = await buildApp();
    const pol = await app.inject({ method: "PUT", url: "/v1/crm/deals/close-policy", headers: headers(), payload: { competitorRequiredOnLoss: true } });
    expect(pol.statusCode).toBe(202);
    await drainQueue();

    const noComp = await app.inject({ method: "POST", url: `/v1/crm/deals/${OPEN3}/close`, headers: headers(), payload: { outcome: "lost", reason: "Lost on price to a rival" } });
    expect(noComp.statusCode).toBe(422);
    expect(noComp.json().code).toBe("COMPETITOR_REQUIRED");

    const withComp = await app.inject({ method: "POST", url: `/v1/crm/deals/${OPEN4}/close`, headers: headers(), payload: { outcome: "lost", reason: "Lost on price to a rival", competitor: ["RivalCorp"] } });
    await app.close();
    expect(withComp.statusCode).toBe(202);
    await drainQueue();
    const rows = await scoped((tx) => tx<Array<{ stage: string; closeOutcome: string | null; closeCompetitor: unknown }>>`
      SELECT stage, close_outcome AS "closeOutcome", close_competitor AS "closeCompetitor" FROM crm.deals WHERE id = ${OPEN4} AND tenant_id = ${TENANT}`);
    expect(rows[0]!.stage).toBe("Lost");
    expect(rows[0]!.closeOutcome).toBe("lost");
    expect(rows[0]!.closeCompetitor).toEqual(["RivalCorp"]);
  });
});

describe("RLS cross-tenant isolation", () => {
  it("another tenant cannot see this tenant's pipeline or stage-limits", async () => {
    const app = await buildApp();
    const pipes = await app.inject({ method: "GET", url: "/v1/crm/pipelines", headers: headers(["crm_user"], OTHER) });
    expect(pipes.json().data.find((p: { id: string }) => p.id === PIPE_ID)).toBeUndefined();
    const limits = await app.inject({ method: "GET", url: "/v1/crm/stage-limits", headers: headers(["crm_admin"], OTHER) });
    await app.close();
    expect(limits.json().data.length).toBe(0);
  });
});
