/**
 * G1 + G2 (spec §25) — stage vocabulary and journey template HTTP surface.
 *
 * Every endpoint is exercised for its happy path plus 400 (zod), 401 (no token), 403
 * (wrong role) and 404 (missing id), and the two governance rules that only exist because
 * of this feature are proved end to end:
 *
 *   1. a canonical stage row is readable by ANY tenant and writable by NONE — not by
 *      tenant_admin, not by super_admin, and not by direct SQL either (the 0081 trigger);
 *   2. a derived template may adapt step detail but cannot rename, drop or reorder a
 *      standardised measurement point.
 *
 * Writes are CQRS, so a 202 is only believed once the queue has drained and the read path
 * shows the row. Tenant ids are per-run `randomUUID()`s and nothing outside those tenants
 * is ever deleted — the platform sentinel tenant's canonical rows in particular are only
 * ever read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { PLATFORM_TENANT_ID, type JourneyStep } from "../src/modules/journeys/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

/** A uuid that is well-formed but names nothing, for the 404 cases. */
const MISSING_ID = randomUUID();

type Method = "GET" | "POST" | "PATCH" | "DELETE";

function headers(
  roles: string[] = ["crm_admin"],
  tenantId: string = TENANT_A,
): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-jt" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: Method,
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    ...(opts.noAuth ? {} : { headers: opts.headers ?? headers() }),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

/** The in-memory bus swallows a failed delivery into its DLQ, so surface the reason. */
function dlqErrors(): string[] {
  return ((queue as unknown as { dlq?: Array<{ topic: string; error: string }> }).dlq ?? [])
    .map((d) => `${d.topic}: ${d.error}`);
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

interface StageView {
  id: string;
  stageCode: string;
  displayName: string;
  ordinal: number;
  required: boolean;
  governance: string;
  version: number;
}

interface TemplateView {
  id: string;
  templateKey: string;
  name: string;
  status: string;
  versionNumber: number;
  parentTemplateId: string | null;
  steps: JourneyStep[];
  publishedAt: string | null;
  deprecatedAt: string | null;
  version: number;
}

function step(stageCode: string, ordinal: number, extra: Partial<JourneyStep> = {}): JourneyStep {
  return { id: randomUUID(), stageCode, ordinal, ...extra };
}

/** Three required canonical stages, in vocabulary order. */
const ROOT_STEPS: JourneyStep[] = [
  step("lead_captured", 10, { slaHours: 24, communicationTemplateRef: "national_welcome" }),
  step("qualified", 20, { slaHours: 48, mandatoryFields: ["phone"] }),
  step("agreed", 40, { slaHours: 96, assignmentRule: "round_robin" }),
];

async function createStage(
  body: Record<string, unknown>,
  hdrs: Record<string, string> = headers(),
): Promise<{ status: number; id: string }> {
  const res = await call("POST", "/v1/crm/stage-vocabulary", { headers: hdrs, payload: body });
  return { status: res.statusCode, id: (res.json() as { id?: string }).id ?? "" };
}

async function getStage(id: string, hdrs: Record<string, string> = headers()) {
  return call("GET", `/v1/crm/stage-vocabulary/${id}`, { headers: hdrs });
}

async function createTemplate(
  body: Record<string, unknown>,
  hdrs: Record<string, string> = headers(),
) {
  return call("POST", "/v1/crm/journey-templates", { headers: hdrs, payload: body });
}

async function templateById(id: string, hdrs: Record<string, string> = headers()): Promise<TemplateView> {
  const res = await call("GET", `/v1/crm/journey-templates/${id}`, { headers: hdrs });
  expect(res.statusCode, `template ${id} should be readable; dlq=${JSON.stringify(dlqErrors())}`).toBe(200);
  return (res.json() as { data: TemplateView }).data;
}

/** A template key unique to this run, so a rerun cannot collide on version uniqueness. */
function key(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8).replace(/[^a-z0-9]/g, "x")}`;
}

async function canonicalStageId(stageCode: string): Promise<string> {
  const rows = (await scoped(TENANT_A, (tx) => tx`
    SELECT id FROM crm.stage_vocabulary
    WHERE tenant_id = ${PLATFORM_TENANT_ID} AND stage_code = ${stageCode}
  `)) as unknown as Array<{ id: string }>;
  expect(rows, `canonical seed row ${stageCode} must exist (migration 0082)`).toHaveLength(1);
  return rows[0]!.id;
}

/** Only ever this run's two tenants. The platform sentinel's rows are never touched. */
async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await scoped(tenantId, async (tx) => {
      await tx`DELETE FROM crm.journey_templates WHERE tenant_id = ${tenantId}`;
      await tx`DELETE FROM crm.stage_vocabulary WHERE tenant_id = ${tenantId}`;
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tenantId}`;
    }).catch(() => {});
  }
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

// ── GET /v1/crm/stage-vocabulary ───────────────────────────────────────────────

describe("GET /v1/crm/stage-vocabulary", () => {
  it("lists the canonical vocabulary for a tenant that has added nothing", async () => {
    const res = await call("GET", "/v1/crm/stage-vocabulary?limit=200");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: StageView[]; meta: { page: number; pageSize: number; total: number } };
    const codes = body.data.map((s) => s.stageCode);
    expect(codes).toContain("lead_captured");
    expect(codes).toContain("agreed");
    expect(body.data.every((s) => s.governance === "canonical")).toBe(true);
    expect(body.meta.total).toBeGreaterThanOrEqual(8);
    expect(body.meta.pageSize).toBe(200);
    expect(body.meta.page).toBe(1);
  });

  it("returns the rows in vocabulary order so a funnel renders without sorting", async () => {
    const res = await call("GET", "/v1/crm/stage-vocabulary?limit=200");
    const ordinals = (res.json() as { data: StageView[] }).data.map((s) => s.ordinal);
    expect([...ordinals].sort((a, b) => a - b)).toEqual(ordinals);
  });

  it("filters by governance", async () => {
    const res = await call("GET", "/v1/crm/stage-vocabulary?limit=200&governance=tenant");
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: StageView[] }).data;
    expect(data.every((s) => s.governance === "tenant")).toBe(true);
  });

  it("reports the offset window in meta.page", async () => {
    const res = await call("GET", "/v1/crm/stage-vocabulary?limit=2&offset=4");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { meta: { page: number } }).meta.page).toBe(3);
  });

  it("allows a plain crm_user — reading the vocabulary is not governance", async () => {
    const res = await call("GET", "/v1/crm/stage-vocabulary", { headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for a limit outside the allowed window", async () => {
    expect((await call("GET", "/v1/crm/stage-vocabulary?limit=0")).statusCode).toBe(400);
    expect((await call("GET", "/v1/crm/stage-vocabulary?limit=500")).statusCode).toBe(400);
  });

  it("returns 400 for an unknown governance value", async () => {
    const res = await call("GET", "/v1/crm/stage-vocabulary?governance=national");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    expect((await call("GET", "/v1/crm/stage-vocabulary", { noAuth: true })).statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", "/v1/crm/stage-vocabulary", { headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/crm/stage-vocabulary/:id ───────────────────────────────────────────

describe("GET /v1/crm/stage-vocabulary/:id", () => {
  it("reads a canonical row by id", async () => {
    const id = await canonicalStageId("lead_captured");
    const res = await getStage(id);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: StageView }).data;
    expect(data.stageCode).toBe("lead_captured");
    expect(data.governance).toBe("canonical");
    expect(data.required).toBe(true);
  });

  it("returns 400 for an id that is not a uuid", async () => {
    expect((await getStage("not-a-uuid")).statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    const res = await getStage(MISSING_ID);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", `/v1/crm/stage-vocabulary/${MISSING_ID}`, { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await getStage(MISSING_ID, headers(["citizen"]));
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/crm/stage-vocabulary ──────────────────────────────────────────────

describe("POST /v1/crm/stage-vocabulary", () => {
  it("accepts a tenant stage code and durably persists it as governance=tenant", async () => {
    const created = await createStage({
      stageCode: "site_survey",
      displayName: "Site Survey",
      description: "Field visit before a proposal is issued.",
      ordinal: 25,
      required: true,
    });
    expect(created.status).toBe(202);

    const res = await getStage(created.id);
    expect(res.statusCode, `202 with no row is a silent write failure; dlq=${JSON.stringify(dlqErrors())}`)
      .toBe(200);
    const data = (res.json() as { data: StageView }).data;
    expect(data.stageCode).toBe("site_survey");
    expect(data.ordinal).toBe(25);
    expect(data.required).toBe(true);
    expect(data.governance, "a tenant cannot mint canonical vocabulary").toBe("tenant");
    expect(data.version).toBe(1);
  });

  it("defaults ordinal to 0 and required to false", async () => {
    const created = await createStage({ stageCode: "tenant_default_stage", displayName: "Defaults" });
    expect(created.status).toBe(202);
    const data = (await getStage(created.id)).json().data as StageView;
    expect(data.ordinal).toBe(0);
    expect(data.required).toBe(false);
  });

  it("returns 409 when the tenant already uses that stage code", async () => {
    const res = await call("POST", "/v1/crm/stage-vocabulary", {
      payload: { stageCode: "site_survey", displayName: "Site Survey Again" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_STAGE_CODE");
  });

  it("returns 422 rather than letting a tenant code shadow a canonical one", async () => {
    const res = await call("POST", "/v1/crm/stage-vocabulary", {
      payload: { stageCode: "qualified", displayName: "Qualified (our wording)" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CANONICAL_STAGE_IMMUTABLE");
  });

  it("returns 400 for a stage code that is not lower snake_case", async () => {
    for (const stageCode of ["Site Survey", "SiteSurvey", "9_survey", "s"]) {
      const res = await call("POST", "/v1/crm/stage-vocabulary", {
        payload: { stageCode, displayName: "Rejected" },
      });
      expect(res.statusCode, stageCode).toBe(400);
    }
  });

  it("returns 400 when displayName is missing or empty", async () => {
    expect((await call("POST", "/v1/crm/stage-vocabulary", {
      payload: { stageCode: "no_name_stage" },
    })).statusCode).toBe(400);
    expect((await call("POST", "/v1/crm/stage-vocabulary", {
      payload: { stageCode: "no_name_stage", displayName: "" },
    })).statusCode).toBe(400);
  });

  it("ignores an attempt to declare the new code canonical", async () => {
    const created = await createStage({
      stageCode: "sneaky_canonical",
      displayName: "Sneaky",
      governance: "canonical",
    });
    expect(created.status).toBe(202);
    expect((await getStage(created.id)).json().data.governance).toBe("tenant");
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", "/v1/crm/stage-vocabulary", {
      noAuth: true,
      payload: { stageCode: "unauth_stage", displayName: "Unauthenticated" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user — the vocabulary is governance", async () => {
    const res = await call("POST", "/v1/crm/stage-vocabulary", {
      headers: headers(["crm_user"]),
      payload: { stageCode: "forbidden_stage", displayName: "Forbidden" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── PATCH /v1/crm/stage-vocabulary/:id ─────────────────────────────────────────

describe("PATCH /v1/crm/stage-vocabulary/:id", () => {
  let stageId: string;

  beforeAll(async () => {
    const created = await createStage({
      stageCode: "patchable_stage",
      displayName: "Patchable",
      ordinal: 55,
    });
    expect(created.status).toBe(202);
    stageId = created.id;
  });

  it("amends the display name and bumps the row version", async () => {
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${stageId}`, {
      payload: { displayName: "Patched Display", ordinal: 56, required: true, version: 1 },
    });
    expect(res.statusCode).toBe(202);

    const data = (await getStage(stageId)).json().data as StageView;
    expect(data.displayName).toBe("Patched Display");
    expect(data.ordinal).toBe(56);
    expect(data.required).toBe(true);
    expect(data.version).toBe(2);
  });

  it("clears a description when null is sent explicitly", async () => {
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${stageId}`, {
      payload: { description: null, version: 2 },
    });
    expect(res.statusCode).toBe(202);
    expect((await getStage(stageId)).json().data.description).toBeNull();
  });

  it("returns 409 for a stale version rather than accepting a command that would be dropped", async () => {
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${stageId}`, {
      payload: { displayName: "Stale", version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
    expect((await getStage(stageId)).json().data.displayName).not.toBe("Stale");
  });

  it("returns 400 when version is missing", async () => {
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${stageId}`, {
      payload: { displayName: "No Version" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when no mutable field is supplied", async () => {
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${stageId}`, {
      payload: { version: 3 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an id that is not a uuid", async () => {
    const res = await call("PATCH", "/v1/crm/stage-vocabulary/nope", {
      payload: { displayName: "X", version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${MISSING_ID}`, {
      payload: { displayName: "X", version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${stageId}`, {
      noAuth: true,
      payload: { displayName: "X", version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${stageId}`, {
      headers: headers(["crm_user"]),
      payload: { displayName: "X", version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── DELETE /v1/crm/stage-vocabulary/:id ────────────────────────────────────────

describe("DELETE /v1/crm/stage-vocabulary/:id", () => {
  it("removes a tenant stage code so it stops being part of the vocabulary", async () => {
    const created = await createStage({ stageCode: "deletable_stage", displayName: "Deletable" });
    expect(created.status).toBe(202);

    const res = await call("DELETE", `/v1/crm/stage-vocabulary/${created.id}`);
    expect(res.statusCode).toBe(202);
    expect((await getStage(created.id)).statusCode).toBe(404);
  });

  it("returns 400 for an id that is not a uuid", async () => {
    expect((await call("DELETE", "/v1/crm/stage-vocabulary/nope")).statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    expect((await call("DELETE", `/v1/crm/stage-vocabulary/${MISSING_ID}`)).statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await call("DELETE", `/v1/crm/stage-vocabulary/${MISSING_ID}`, { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("DELETE", `/v1/crm/stage-vocabulary/${MISSING_ID}`, {
      headers: headers(["crm_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── G1: the canonical vocabulary is read-only for everyone ─────────────────────

describe("canonical stage rows are readable by any tenant and writable by none", () => {
  it("both tenants see the same canonical rows", async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      const res = await call("GET", "/v1/crm/stage-vocabulary?limit=200&governance=canonical", {
        headers: headers(["crm_user"], tenantId),
      });
      expect(res.statusCode).toBe(200);
      const codes = (res.json() as { data: StageView[] }).data.map((s) => s.stageCode);
      expect(codes).toEqual(expect.arrayContaining(["lead_captured", "qualified", "agreed", "churned"]));
    }
  });

  it("a canonical row is readable by a tenant that does not own it", async () => {
    const id = await canonicalStageId("agreed");
    const res = await getStage(id, headers(["crm_user"], TENANT_B));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: StageView }).data.governance).toBe("canonical");
  });

  it.each([
    ["crm_admin", TENANT_A],
    ["tenant_admin", TENANT_B],
    ["super_admin", TENANT_A],
  ])("refuses a rename by %s with 422 — no role can override this", async (role, tenantId) => {
    const id = await canonicalStageId("qualified");
    const res = await call("PATCH", `/v1/crm/stage-vocabulary/${id}`, {
      headers: headers([role], tenantId),
      payload: { displayName: "Locally Renamed", version: 1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CANONICAL_STAGE_IMMUTABLE");
  });

  it("refuses a delete of a canonical row with 422", async () => {
    const id = await canonicalStageId("churned");
    const res = await call("DELETE", `/v1/crm/stage-vocabulary/${id}`, {
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CANONICAL_STAGE_IMMUTABLE");
  });

  it("leaves the canonical row exactly as the seed left it after every refused attempt", async () => {
    const res = await getStage(await canonicalStageId("qualified"));
    const data = (res.json() as { data: StageView }).data;
    expect(data.displayName).toBe("Qualified");
    expect(data.version).toBe(1);
  });

  it("the database refuses a direct UPDATE of a canonical row (migration 0081)", async () => {
    const id = await canonicalStageId("lead_captured");
    await expect(scoped(TENANT_A, (tx) => tx`
      UPDATE crm.stage_vocabulary SET display_name = 'Renamed By SQL' WHERE id = ${id}
    `)).rejects.toThrow(/CANONICAL_IMMUTABLE/);
    expect((await getStage(id)).json().data.displayName).toBe("Lead Captured");
  });

  it("the database refuses a direct DELETE of a canonical row (migration 0081)", async () => {
    const id = await canonicalStageId("onboarded");
    await expect(scoped(TENANT_A, (tx) => tx`
      DELETE FROM crm.stage_vocabulary WHERE id = ${id}
    `)).rejects.toThrow(/CANONICAL_IMMUTABLE/);
    expect((await getStage(id)).statusCode).toBe(200);
  });
});

// ── Journey templates (G2) ─────────────────────────────────────────────────────

/**
 * A template row with a parent that does not exist, planted directly so the broken-
 * derivation paths can be exercised. The route refuses to CREATE one of these, which is
 * exactly why it has to be planted to test what happens when configuration is already
 * broken (a parent removed out from under a child).
 */
async function seedOrphanTemplate(): Promise<string> {
  const id = randomUUID();
  await scoped(TENANT_A, (tx) => tx`
    INSERT INTO crm.journey_templates
      (id, tenant_id, template_key, name, governance, parent_template_id, steps,
       version_number, status, created_by, updated_by)
    VALUES (${id}, ${TENANT_A}, ${key("orphan")}, 'Orphaned Template', 'tenant',
            ${randomUUID()}, ${JSON.stringify(ROOT_STEPS)}::jsonb, 1, 'draft',
            ${ACTOR}, ${ACTOR})
  `);
  return id;
}

describe("POST /v1/crm/journey-templates", () => {
  const REGIONAL_STAGE = "regional_visit";

  beforeAll(async () => {
    // A tenant stage code a derived template can legitimately add of its own.
    await createStage({ stageCode: REGIONAL_STAGE, displayName: "Regional Visit", ordinal: 25 });
  });

  it("creates a draft at version 1 of its key and persists the steps", async () => {
    const templateKey = key("national_acq");
    const res = await createTemplate({
      templateKey,
      name: "National Acquisition Journey",
      description: "The national definition every circle derives from.",
      steps: ROOT_STEPS,
      product: "current_account",
      region: "national",
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { id: string }).id;

    const template = await templateById(id);
    expect(template.templateKey).toBe(templateKey);
    expect(template.status, "a template is born a draft").toBe("draft");
    expect(template.versionNumber).toBe(1);
    expect(template.publishedAt).toBeNull();
    expect(template.steps.map((s) => s.stageCode)).toEqual(["lead_captured", "qualified", "agreed"]);
    expect(template.steps[0]?.slaHours).toBe(24);
    expect(template.parentTemplateId).toBeNull();
  });

  it("creates a derived template that adapts step detail and adds a tenant stage", async () => {
    const parent = await createTemplate({
      templateKey: key("derivable"),
      name: "Derivable Parent",
      steps: ROOT_STEPS,
    });
    const parentId = (parent.json() as { id: string }).id;

    const child = await createTemplate({
      templateKey: key("circle_variant"),
      name: "Circle Variant",
      parentTemplateId: parentId,
      steps: [
        step("lead_captured", 10, { slaHours: 4, communicationTemplateRef: "circle_welcome" }),
        step("qualified", 20),
        step(REGIONAL_STAGE, 25, { slaHours: 12 }),
        step("agreed", 40),
      ],
    });
    expect(child.statusCode, JSON.stringify(child.json())).toBe(202);
    const childView = await templateById((child.json() as { id: string }).id);
    expect(childView.parentTemplateId).toBe(parentId);
  });

  it("refuses a stage code that is not in the effective vocabulary (422)", async () => {
    const res = await createTemplate({
      templateKey: key("unknown_stage"),
      name: "Unknown Stage",
      steps: [step("invented_stage", 10)],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("UNKNOWN_STAGE_CODE");
  });

  it("refuses canonical stages ordered against the vocabulary (422)", async () => {
    const res = await createTemplate({
      templateKey: key("bad_order"),
      name: "Reordered Canonical",
      steps: [step("qualified", 10), step("lead_captured", 20)],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CANONICAL_ORDER_VIOLATED");
  });

  it("refuses a duplicated stage code (422)", async () => {
    const res = await createTemplate({
      templateKey: key("dupe_stage"),
      name: "Duplicated Stage",
      steps: [step("qualified", 10), step("qualified", 20)],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("DUPLICATE_STAGE_CODE");
  });

  it("refuses a derived template that drops a required parent step (422)", async () => {
    const parent = await createTemplate({
      templateKey: key("strict_parent"),
      name: "Strict Parent",
      steps: ROOT_STEPS,
    });
    const parentId = (parent.json() as { id: string }).id;

    const res = await createTemplate({
      templateKey: key("dropping_child"),
      name: "Dropping Child",
      parentTemplateId: parentId,
      steps: [step("lead_captured", 10), step("qualified", 20)],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("REQUIRED_STEP_DROPPED");
    expect(res.json().message).toContain("agreed");
  });

  it("refuses a parent that does not exist (422)", async () => {
    const res = await createTemplate({
      templateKey: key("no_parent"),
      name: "No Parent",
      parentTemplateId: MISSING_ID,
      steps: ROOT_STEPS,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PARENT_TEMPLATE_NOT_FOUND");
  });

  it("refuses a parent that does not itself resolve (422)", async () => {
    const orphanId = await seedOrphanTemplate();
    const res = await createTemplate({
      templateKey: key("child_of_broken"),
      name: "Child Of Broken Parent",
      parentTemplateId: orphanId,
      steps: ROOT_STEPS,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PARENT_TEMPLATE_INVALID");
  });

  it("returns 400 for an empty step list", async () => {
    const res = await createTemplate({ templateKey: key("no_steps"), name: "No Steps", steps: [] });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a template key that is not lower snake_case", async () => {
    const res = await createTemplate({ templateKey: "Not A Key", name: "Bad Key", steps: ROOT_STEPS });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    const res = await createTemplate({ templateKey: key("no_name"), steps: ROOT_STEPS });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a step whose id is not a uuid", async () => {
    const res = await createTemplate({
      templateKey: key("bad_step_id"),
      name: "Bad Step Id",
      steps: [{ id: "step-1", stageCode: "qualified", ordinal: 10 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a negative SLA", async () => {
    const res = await createTemplate({
      templateKey: key("bad_sla"),
      name: "Bad SLA",
      steps: [step("qualified", 10, { slaHours: -1 })],
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", "/v1/crm/journey-templates", {
      noAuth: true,
      payload: { templateKey: key("unauth"), name: "Unauthenticated", steps: ROOT_STEPS },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user — templates are governance", async () => {
    const res = await createTemplate(
      { templateKey: key("forbidden"), name: "Forbidden", steps: ROOT_STEPS },
      headers(["crm_user"]),
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/journey-templates", () => {
  const LISTED_KEY = key("listed");

  beforeAll(async () => {
    const res = await createTemplate({
      templateKey: LISTED_KEY,
      name: "Listed Template",
      steps: ROOT_STEPS,
      product: "term_loan",
      region: "west",
      businessUnit: "retail",
    });
    expect(res.statusCode).toBe(202);
  });

  it("lists the tenant's templates in the standard envelope", async () => {
    const res = await call("GET", "/v1/crm/journey-templates?limit=200");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: TemplateView[]; meta: { total: number; pageSize: number } };
    expect(body.data.map((t) => t.templateKey)).toContain(LISTED_KEY);
    expect(body.meta.total).toBe(body.data.length);
  });

  it("filters by templateKey", async () => {
    const res = await call("GET", `/v1/crm/journey-templates?templateKey=${LISTED_KEY}`);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: TemplateView[] }).data;
    expect(data).toHaveLength(1);
    expect(data[0]?.templateKey).toBe(LISTED_KEY);
  });

  it("filters by status and governance", async () => {
    const res = await call("GET", "/v1/crm/journey-templates?limit=200&status=draft&governance=tenant");
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: TemplateView[] }).data;
    expect(data.every((t) => t.status === "draft")).toBe(true);
  });

  it("treats a NULL scope column as matching any requested scope value", async () => {
    const scoped200 = await call(
      "GET",
      `/v1/crm/journey-templates?limit=200&product=term_loan&region=west&businessUnit=retail`,
    );
    expect(scoped200.statusCode).toBe(200);
    expect((scoped200.json() as { data: TemplateView[] }).data.map((t) => t.templateKey))
      .toContain(LISTED_KEY);

    // A different product must not match a row scoped to term_loan.
    const other = await call("GET", "/v1/crm/journey-templates?limit=200&product=overdraft");
    expect((other.json() as { data: TemplateView[] }).data.map((t) => t.templateKey))
      .not.toContain(LISTED_KEY);
  });

  it("allows a plain crm_user to read", async () => {
    const res = await call("GET", "/v1/crm/journey-templates", { headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for an unknown status filter", async () => {
    expect((await call("GET", "/v1/crm/journey-templates?status=retired")).statusCode).toBe(400);
  });

  it("returns 400 for a limit outside the allowed window", async () => {
    expect((await call("GET", "/v1/crm/journey-templates?limit=201")).statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    expect((await call("GET", "/v1/crm/journey-templates", { noAuth: true })).statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", "/v1/crm/journey-templates", { headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/journey-templates/:id", () => {
  let templateId: string;

  beforeAll(async () => {
    const res = await createTemplate({
      templateKey: key("readable"),
      name: "Readable Template",
      steps: ROOT_STEPS,
    });
    templateId = (res.json() as { id: string }).id;
  });

  it("reads one version row", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${templateId}`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: TemplateView }).data.name).toBe("Readable Template");
  });

  it("returns 400 for an id that is not a uuid", async () => {
    expect((await call("GET", "/v1/crm/journey-templates/nope")).statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${MISSING_ID}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${templateId}`, { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${templateId}`, {
      headers: headers(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/journey-templates/:id/resolved", () => {
  const CHILD_STAGE = "resolved_extra_stage";
  let rootId: string;
  let childId: string;

  beforeAll(async () => {
    await createStage({ stageCode: CHILD_STAGE, displayName: "Resolved Extra", ordinal: 25 });
    const root = await createTemplate({
      templateKey: key("resolve_root"),
      name: "Resolve Root",
      steps: ROOT_STEPS,
    });
    rootId = (root.json() as { id: string }).id;
    const child = await createTemplate({
      templateKey: key("resolve_child"),
      name: "Resolve Child",
      parentTemplateId: rootId,
      steps: [
        step("lead_captured", 10, { slaHours: 6 }),
        step("qualified", 20, { mandatoryFields: ["phone", "gstin"] }),
        step(CHILD_STAGE, 25),
        step("agreed", 40),
      ],
    });
    expect(child.statusCode, JSON.stringify(child.json())).toBe(202);
    childId = (child.json() as { id: string }).id;
  });

  it("resolves a root template to its own steps and an empty chain of one", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${rootId}/resolved`);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { chain: string[]; steps: JourneyStep[]; overrides: Record<string, string[]> } }).data;
    expect(data.chain).toEqual([rootId]);
    expect(data.steps.map((s) => s.stageCode)).toEqual(["lead_captured", "qualified", "agreed"]);
    expect(data.overrides).toEqual({});
  });

  it("composes the parent with the child's adaptations and reports what changed", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${childId}/resolved`);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as {
      data: { chain: string[]; steps: JourneyStep[]; overrides: Record<string, string[]> };
    }).data;
    expect(data.chain).toEqual([rootId, childId]);
    expect(data.steps.map((s) => s.stageCode)).toEqual([
      "lead_captured", "qualified", CHILD_STAGE, "agreed",
    ]);
    expect(data.steps[0]?.slaHours, "the child's SLA wins").toBe(6);
    expect(data.steps[0]?.communicationTemplateRef, "an unstated field stays the parent's")
      .toBe("national_welcome");
    expect(data.overrides).toEqual({
      lead_captured: ["slaHours"],
      qualified: ["mandatoryFields"],
    });
  });

  it("answers 422 with the violation for a template whose parent has gone", async () => {
    const orphanId = await seedOrphanTemplate();
    const res = await call("GET", `/v1/crm/journey-templates/${orphanId}/resolved`);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PARENT_TEMPLATE_NOT_FOUND");
  });

  it("returns 400 for an id that is not a uuid", async () => {
    expect((await call("GET", "/v1/crm/journey-templates/nope/resolved")).statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    expect((await call("GET", `/v1/crm/journey-templates/${MISSING_ID}/resolved`)).statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${rootId}/resolved`, { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${rootId}/resolved`, {
      headers: headers(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/crm/journey-templates/:id", () => {
  let draftId: string;

  beforeAll(async () => {
    const res = await createTemplate({
      templateKey: key("patchable_tpl"),
      name: "Patchable Template",
      steps: ROOT_STEPS,
    });
    draftId = (res.json() as { id: string }).id;
  });

  it("amends a draft's name, scope and steps, bumping the row version", async () => {
    const newSteps = [
      step("lead_captured", 10, { slaHours: 8 }),
      step("qualified", 20),
      step("agreed", 40),
    ];
    const res = await call("PATCH", `/v1/crm/journey-templates/${draftId}`, {
      payload: { name: "Patched Template", product: "overdraft", steps: newSteps, version: 1 },
    });
    expect(res.statusCode).toBe(202);

    const after = await templateById(draftId);
    expect(after.name).toBe("Patched Template");
    expect(after.steps[0]?.slaHours).toBe(8);
    expect(after.version).toBe(2);
    expect(after.status).toBe("draft");
  });

  it("refuses steps that break the vocabulary rules (422) and leaves the draft alone", async () => {
    const before = await templateById(draftId);
    const res = await call("PATCH", `/v1/crm/journey-templates/${draftId}`, {
      payload: { steps: [step("not_a_stage", 10)], version: 2 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("UNKNOWN_STAGE_CODE");
    expect((await templateById(draftId)).version).toBe(before.version);
  });

  it("returns 409 for a stale version", async () => {
    const res = await call("PATCH", `/v1/crm/journey-templates/${draftId}`, {
      payload: { name: "Stale Patch", version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("returns 400 when version is missing", async () => {
    const res = await call("PATCH", `/v1/crm/journey-templates/${draftId}`, {
      payload: { name: "No Version" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when no mutable field is supplied", async () => {
    const res = await call("PATCH", `/v1/crm/journey-templates/${draftId}`, { payload: { version: 2 } });
    expect(res.statusCode).toBe(400);
  });

  it("refuses to amend a published definition (422) — publish a new version instead", async () => {
    const created = await createTemplate({
      templateKey: key("published_patch"),
      name: "Published Template",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;
    expect((await call("POST", `/v1/crm/journey-templates/${id}/publish`)).statusCode).toBe(202);

    const res = await call("PATCH", `/v1/crm/journey-templates/${id}`, {
      payload: { name: "Rewriting History", version: 2 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TEMPLATE_NOT_EDITABLE");
    expect((await templateById(id)).name).toBe("Published Template");
  });

  it("refuses to amend a deprecated definition (422)", async () => {
    const created = await createTemplate({
      templateKey: key("deprecated_patch"),
      name: "Deprecated Template",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;
    expect((await call("POST", `/v1/crm/journey-templates/${id}/publish`)).statusCode).toBe(202);
    expect((await call("POST", `/v1/crm/journey-templates/${id}/deprecate`)).statusCode).toBe(202);

    const res = await call("PATCH", `/v1/crm/journey-templates/${id}`, {
      payload: { name: "Rewriting History", version: 3 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TEMPLATE_NOT_EDITABLE");
  });

  it("returns 400 for an id that is not a uuid", async () => {
    const res = await call("PATCH", "/v1/crm/journey-templates/nope", {
      payload: { name: "X", version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    const res = await call("PATCH", `/v1/crm/journey-templates/${MISSING_ID}`, {
      payload: { name: "X", version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await call("PATCH", `/v1/crm/journey-templates/${draftId}`, {
      noAuth: true,
      payload: { name: "X", version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("PATCH", `/v1/crm/journey-templates/${draftId}`, {
      headers: headers(["crm_user"]),
      payload: { name: "X", version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/crm/journey-templates/:id", () => {
  it("removes a draft", async () => {
    const created = await createTemplate({
      templateKey: key("deletable_tpl"),
      name: "Deletable Template",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;

    const res = await call("DELETE", `/v1/crm/journey-templates/${id}`);
    expect(res.statusCode).toBe(202);
    expect((await call("GET", `/v1/crm/journey-templates/${id}`)).statusCode).toBe(404);
  });

  it("refuses to delete a published definition (422) — history is deprecated, not deleted", async () => {
    const created = await createTemplate({
      templateKey: key("published_delete"),
      name: "Published Undeletable",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;
    expect((await call("POST", `/v1/crm/journey-templates/${id}/publish`)).statusCode).toBe(202);

    const res = await call("DELETE", `/v1/crm/journey-templates/${id}`);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TEMPLATE_NOT_DELETABLE");
    expect((await templateById(id)).status).toBe("published");
  });

  it("returns 400 for an id that is not a uuid", async () => {
    expect((await call("DELETE", "/v1/crm/journey-templates/nope")).statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    expect((await call("DELETE", `/v1/crm/journey-templates/${MISSING_ID}`)).statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await call("DELETE", `/v1/crm/journey-templates/${MISSING_ID}`, { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("DELETE", `/v1/crm/journey-templates/${MISSING_ID}`, {
      headers: headers(["crm_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/crm/journey-templates/:id/publish", () => {
  it("publishes a draft in place when the definition has not changed", async () => {
    const created = await createTemplate({
      templateKey: key("publish_inplace"),
      name: "Publish In Place",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;

    const res = await call("POST", `/v1/crm/journey-templates/${id}/publish`);
    expect(res.statusCode).toBe(202);
    expect((res.json() as { id: string }).id, "no new row when nothing changed").toBe(id);

    const after = await templateById(id);
    expect(after.status).toBe("published");
    expect(after.publishedAt).not.toBeNull();
    expect(after.versionNumber).toBe(1);
  });

  it("publishing a changed definition creates a NEW version row and retires the draft", async () => {
    const templateKey = key("publish_new");
    const created = await createTemplate({ templateKey, name: "Publish New", steps: ROOT_STEPS });
    const draftId = (created.json() as { id: string }).id;

    const changed = [
      step("lead_captured", 10, { slaHours: 2 }),
      step("qualified", 20),
      step("agreed", 40),
    ];
    const res = await call("POST", `/v1/crm/journey-templates/${draftId}/publish`, {
      payload: { steps: changed },
    });
    expect(res.statusCode).toBe(202);
    const newId = (res.json() as { id: string }).id;
    expect(newId, "the caller gets back the row it created").not.toBe(draftId);

    const published = await templateById(newId);
    expect(published.status).toBe("published");
    expect(published.versionNumber).toBe(2);
    expect(published.templateKey).toBe(templateKey);
    expect(published.steps[0]?.slaHours).toBe(2);
    expect(published.publishedAt).not.toBeNull();

    // A draft never was the live definition, so it is removed rather than deprecated.
    expect((await call("GET", `/v1/crm/journey-templates/${draftId}`)).statusCode).toBe(404);
  });

  it("republishing a published template with new steps deprecates the row it supersedes", async () => {
    const templateKey = key("publish_super");
    const created = await createTemplate({ templateKey, name: "Publish Superseding", steps: ROOT_STEPS });
    const firstId = (created.json() as { id: string }).id;
    expect((await call("POST", `/v1/crm/journey-templates/${firstId}/publish`)).statusCode).toBe(202);

    const changed = [
      step("lead_captured", 10, { slaHours: 1 }),
      step("qualified", 20),
      step("agreed", 40),
    ];
    const res = await call("POST", `/v1/crm/journey-templates/${firstId}/publish`, {
      payload: { steps: changed },
    });
    expect(res.statusCode).toBe(202);
    const secondId = (res.json() as { id: string }).id;

    const superseded = await templateById(firstId);
    expect(superseded.status, "history stays readable").toBe("deprecated");
    expect(superseded.deprecatedAt).not.toBeNull();
    expect(superseded.steps[0]?.slaHours, "the old definition is not rewritten").toBe(24);

    const live = await templateById(secondId);
    expect(live.status).toBe("published");
    expect(live.versionNumber).toBe(2);
  });

  it("refuses to republish an unchanged published template (422) — supply steps instead", async () => {
    const created = await createTemplate({
      templateKey: key("publish_twice"),
      name: "Publish Twice",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;
    expect((await call("POST", `/v1/crm/journey-templates/${id}/publish`)).statusCode).toBe(202);

    const again = await call("POST", `/v1/crm/journey-templates/${id}/publish`);
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("refuses to publish a deprecated template (422)", async () => {
    const created = await createTemplate({
      templateKey: key("publish_deprecated"),
      name: "Publish Deprecated",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;
    expect((await call("POST", `/v1/crm/journey-templates/${id}/publish`)).statusCode).toBe(202);
    expect((await call("POST", `/v1/crm/journey-templates/${id}/deprecate`)).statusCode).toBe(202);

    const res = await call("POST", `/v1/crm/journey-templates/${id}/publish`, {
      payload: { steps: ROOT_STEPS },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("refuses replacement steps that break the vocabulary rules (422)", async () => {
    const created = await createTemplate({
      templateKey: key("publish_bad_steps"),
      name: "Publish Bad Steps",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;

    const res = await call("POST", `/v1/crm/journey-templates/${id}/publish`, {
      payload: { steps: [step("qualified", 10), step("lead_captured", 20)] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CANONICAL_ORDER_VIOLATED");
    expect((await templateById(id)).status).toBe("draft");
  });

  it("returns 409 for a stale version", async () => {
    const created = await createTemplate({
      templateKey: key("publish_stale"),
      name: "Publish Stale",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;
    const res = await call("POST", `/v1/crm/journey-templates/${id}/publish`, {
      payload: { version: 99 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
    expect((await templateById(id)).status).toBe("draft");
  });

  it("returns 400 for an empty replacement step list", async () => {
    const res = await call("POST", `/v1/crm/journey-templates/${MISSING_ID}/publish`, {
      payload: { steps: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an id that is not a uuid", async () => {
    expect((await call("POST", "/v1/crm/journey-templates/nope/publish")).statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    expect((await call("POST", `/v1/crm/journey-templates/${MISSING_ID}/publish`)).statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", `/v1/crm/journey-templates/${MISSING_ID}/publish`, { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user — publication is governance", async () => {
    const res = await call("POST", `/v1/crm/journey-templates/${MISSING_ID}/publish`, {
      headers: headers(["crm_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/crm/journey-templates/:id/deprecate", () => {
  let publishedId: string;

  beforeAll(async () => {
    const created = await createTemplate({
      templateKey: key("deprecatable"),
      name: "Deprecatable Template",
      steps: ROOT_STEPS,
    });
    publishedId = (created.json() as { id: string }).id;
    expect((await call("POST", `/v1/crm/journey-templates/${publishedId}/publish`)).statusCode).toBe(202);
  });

  it("retires a published version, keeping it readable", async () => {
    const res = await call("POST", `/v1/crm/journey-templates/${publishedId}/deprecate`, {
      payload: { reason: "superseded by the FY27 national journey" },
    });
    expect(res.statusCode).toBe(202);

    const after = await templateById(publishedId);
    expect(after.status).toBe("deprecated");
    expect(after.deprecatedAt).not.toBeNull();
  });

  it("refuses to deprecate a template that is already deprecated (422)", async () => {
    const res = await call("POST", `/v1/crm/journey-templates/${publishedId}/deprecate`);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("refuses to deprecate a draft (422) — a draft is deleted, not retired", async () => {
    const created = await createTemplate({
      templateKey: key("deprecate_draft"),
      name: "Deprecate Draft",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;
    const res = await call("POST", `/v1/crm/journey-templates/${id}/deprecate`);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS_TRANSITION");
    expect((await templateById(id)).status).toBe("draft");
  });

  it("returns 409 for a stale version", async () => {
    const created = await createTemplate({
      templateKey: key("deprecate_stale"),
      name: "Deprecate Stale",
      steps: ROOT_STEPS,
    });
    const id = (created.json() as { id: string }).id;
    expect((await call("POST", `/v1/crm/journey-templates/${id}/publish`)).statusCode).toBe(202);

    const res = await call("POST", `/v1/crm/journey-templates/${id}/deprecate`, {
      payload: { version: 99 },
    });
    expect(res.statusCode).toBe(409);
    expect((await templateById(id)).status).toBe("published");
  });

  it("returns 400 for a reason beyond the allowed length", async () => {
    const res = await call("POST", `/v1/crm/journey-templates/${MISSING_ID}/deprecate`, {
      payload: { reason: "x".repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an id that is not a uuid", async () => {
    expect((await call("POST", "/v1/crm/journey-templates/nope/deprecate")).statusCode).toBe(400);
  });

  it("returns 404 for a well-formed id that names nothing", async () => {
    expect((await call("POST", `/v1/crm/journey-templates/${MISSING_ID}/deprecate`)).statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", `/v1/crm/journey-templates/${MISSING_ID}/deprecate`, { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("POST", `/v1/crm/journey-templates/${MISSING_ID}/deprecate`, {
      headers: headers(["crm_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Tenant isolation across the whole surface ──────────────────────────────────

describe("journey template tenant isolation", () => {
  let templateA: string;
  let stageA: string;

  beforeAll(async () => {
    const created = await createTemplate({
      templateKey: key("isolated"),
      name: "Tenant A Template",
      steps: ROOT_STEPS,
    });
    templateA = (created.json() as { id: string }).id;
    const stage = await createStage({ stageCode: "tenant_a_only_stage", displayName: "Tenant A Only" });
    stageA = stage.id;
  });

  it("tenant B does not see tenant A's template in a list", async () => {
    const res = await call("GET", "/v1/crm/journey-templates?limit=200", {
      headers: headers(["crm_admin"], TENANT_B),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: TemplateView[] }).data.map((t) => t.id)).not.toContain(templateA);
  });

  it("tenant B reading tenant A's template by id gets 404, not 403", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${templateA}`, {
      headers: headers(["crm_admin"], TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot amend, delete, publish or deprecate tenant A's template", async () => {
    const b = headers(["tenant_admin"], TENANT_B);
    expect((await call("PATCH", `/v1/crm/journey-templates/${templateA}`, {
      headers: b, payload: { name: "Hijacked", version: 1 },
    })).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/crm/journey-templates/${templateA}`, { headers: b })).statusCode).toBe(404);
    expect((await call("POST", `/v1/crm/journey-templates/${templateA}/publish`, { headers: b })).statusCode).toBe(404);
    expect((await call("POST", `/v1/crm/journey-templates/${templateA}/deprecate`, { headers: b })).statusCode).toBe(404);

    const after = await templateById(templateA);
    expect(after.name).toBe("Tenant A Template");
    expect(after.status).toBe("draft");
  });

  it("tenant B cannot resolve tenant A's template", async () => {
    const res = await call("GET", `/v1/crm/journey-templates/${templateA}/resolved`, {
      headers: headers(["crm_admin"], TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot see or amend tenant A's stage code", async () => {
    const b = headers(["tenant_admin"], TENANT_B);
    expect((await getStage(stageA, b)).statusCode).toBe(404);
    expect((await call("PATCH", `/v1/crm/stage-vocabulary/${stageA}`, {
      headers: b, payload: { displayName: "Hijacked", version: 1 },
    })).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/crm/stage-vocabulary/${stageA}`, { headers: b })).statusCode).toBe(404);
    expect((await getStage(stageA)).json().data.displayName).toBe("Tenant A Only");
  });

  it("the same stage code may exist independently in both tenants", async () => {
    const inB = await createStage(
      { stageCode: "tenant_a_only_stage", displayName: "Tenant B's own wording" },
      headers(["crm_admin"], TENANT_B),
    );
    expect(inB.status, "a tenant code is not global").toBe(202);
    expect((await getStage(inB.id, headers(["crm_admin"], TENANT_B))).json().data.displayName)
      .toBe("Tenant B's own wording");
  });
});
