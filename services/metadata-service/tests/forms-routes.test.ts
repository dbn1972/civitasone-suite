/**
 * Integration tests for the authenticated forms-engine routes (FRM-04, FRM-05,
 * FRM-07) against live Postgres with RLS ENABLE+FORCE and a NOBYPASSRLS role.
 *
 * Every endpoint gets happy path + 400 + 401 + 403, plus 404/409/422 where the
 * status is meaningful. The two FRM-07 invariants get dedicated tests:
 * the submitter cannot approve, and a published version cannot be mutated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();

function hdr(tid: string, actor: string, roles: string[] = ["metadata_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: actor, tid, roles, sid: "sess-1" }, SECRET)}`,
    "content-type": "application/json",
  };
}

/** Seed entity + two fields + a layout directly, mirroring metadata-routes.test.ts. */
async function seedForm(
  tid: string,
  fields: { apiName: string; required: boolean }[] = [
    { apiName: "entity_type", required: true },
    { apiName: "gstin", required: true },
  ],
): Promise<{ entityId: string; layoutId: string }> {
  const entityId = randomUUID();
  const layoutId = randomUUID();
  const api = `frm_${Math.floor(Math.random() * 1e9)}`;
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
    await sql`INSERT INTO metadata.entity_definitions
      (id, tenant_id, api_name, label, plural_label, created_by, updated_by)
      VALUES (${entityId}, ${tid}, ${api}, ${api}, ${api}, ${MAKER}, ${MAKER})`;
    for (const f of fields) {
      await sql`INSERT INTO metadata.field_definitions
        (tenant_id, entity_def_id, api_name, label, field_type, is_required, created_by, updated_by)
        VALUES (${tid}, ${entityId}, ${f.apiName}, ${f.apiName}, 'text', ${f.required}, ${MAKER}, ${MAKER})`;
    }
    await sql`INSERT INTO metadata.layout_definitions
      (id, tenant_id, entity_def_id, layout_type, sections, created_by, updated_by)
      VALUES (${layoutId}, ${tid}, ${entityId}, 'create', '[]'::jsonb, ${MAKER}, ${MAKER})`;
  });
  return { entityId, layoutId };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  for (const tid of [TENANT, OTHER_TENANT]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
      await sql`DELETE FROM metadata.form_submissions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.form_public_endpoints WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.form_versions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.layout_definitions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.field_definitions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.entity_definitions WHERE tenant_id = ${tid}`;
    });
  }
  await sqlClient.end();
});

/** Create a draft version and return its id. */
async function createDraft(layoutId: string, body: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/v1/metadata/forms/${layoutId}/versions`,
    headers: hdr(TENANT, MAKER),
    body: JSON.stringify(body),
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

/** Drive a draft all the way to published (maker submits, checker approves). */
async function publish(layoutId: string, body: Record<string, unknown> = {}): Promise<string> {
  const id = await createDraft(layoutId, body);
  const submit = await app.inject({
    method: "POST",
    url: `/v1/metadata/form-versions/${id}/submit`,
    headers: hdr(TENANT, MAKER),
    body: "{}",
  });
  expect(submit.statusCode).toBe(200);
  const approve = await app.inject({
    method: "POST",
    url: `/v1/metadata/form-versions/${id}/approve`,
    headers: hdr(TENANT, CHECKER),
    body: "{}",
  });
  expect(approve.statusCode).toBe(200);
  return id;
}

describe("auth on the forms endpoints", () => {
  it("401 without a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/forms/${randomUUID()}/versions?limit=10`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("401 with a malformed token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/forms/${randomUUID()}/versions?limit=10`,
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without metadata admin rights", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/forms/${randomUUID()}/versions?limit=10`,
      headers: hdr(TENANT, MAKER, ["employee"]),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("403 on create for a non-admin role", async () => {
    const { layoutId } = await seedForm(TENANT);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER, ["employee"]),
      body: "{}",
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("FRM-04/FRM-05 — creating a draft version", () => {
  it("creates version 1 with rules and returns the standard single envelope", async () => {
    const { layoutId } = await seedForm(TENANT);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({
        visibilityRules: [{ field: "gstin", showWhen: 'entity_type == "company"' }],
        cascadeRules: [],
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ versionNumber: 1, status: "draft" });
  });

  it("400 when the body carries an unexpected key (strict schema)", async () => {
    const { layoutId } = await seedForm(TENANT);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ tenantId: OTHER_TENANT }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("400 when a rule is structurally wrong", async () => {
    const { layoutId } = await seedForm(TENANT);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ visibilityRules: [{ field: "gstin" }] }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown form (layout)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${randomUUID()}/versions`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 for a layout that belongs to another tenant (RLS)", async () => {
    const { layoutId } = await seedForm(OTHER_TENANT);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(404);
  });

  it("422 REJECTS A CYCLIC CASCADE RULE SET at definition time", async () => {
    const { layoutId } = await seedForm(TENANT, [
      { apiName: "a", required: false },
      { apiName: "b", required: false },
    ]);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({
        cascadeRules: [
          { field: "a", dependsOn: "b", options: { x: ["1"] } },
          { field: "b", dependsOn: "a", options: { y: ["2"] } },
        ],
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("CASCADE_CYCLE");
    expect(res.json().error.message).toContain("cycle");
  });

  it("422 rejects a self-dependent cascade", async () => {
    const { layoutId } = await seedForm(TENANT, [{ apiName: "a", required: false }]);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ cascadeRules: [{ field: "a", dependsOn: "a", options: { x: ["1"] } }] }),
    });
    expect(res.statusCode).toBe(422);
  });

  it("422 rejects a rule referencing a field the entity does not have", async () => {
    const { layoutId } = await seedForm(TENANT);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ visibilityRules: [{ field: "ghost", showWhen: "entity_type == 1" }] }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("FORM_RULES_INVALID");
  });

  it("increments the version number per form", async () => {
    const { layoutId } = await seedForm(TENANT);
    await createDraft(layoutId);
    const second = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(second.json().data.versionNumber).toBe(2);
  });
});

describe("listing versions", () => {
  it("returns the list envelope with page/pageSize/total", async () => {
    const { layoutId } = await seedForm(TENANT);
    await createDraft(layoutId);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/forms/${layoutId}/versions?limit=10`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({ page: 1, pageSize: 10, total: 1 });
  });

  it("400 when limit is missing (limit is required on lists)", async () => {
    const { layoutId } = await seedForm(TENANT);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/forms/${layoutId}/versions`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when limit exceeds 200", async () => {
    const { layoutId } = await seedForm(TENANT);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/forms/${layoutId}/versions?limit=201`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not leak another tenant's versions", async () => {
    const { layoutId } = await seedForm(OTHER_TENANT);
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${OTHER_TENANT}, true)`;
      await sql`INSERT INTO metadata.form_versions
        (tenant_id, layout_def_id, version_number, created_by, updated_by)
        VALUES (${OTHER_TENANT}, ${layoutId}, 1, ${MAKER}, ${MAKER})`;
    });
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/forms/${layoutId}/versions?limit=10`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(0);
  });
});

describe("reading a version", () => {
  it("returns the version", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${id}`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
  });

  it("404 for an unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${randomUUID()}`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 for a non-uuid id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/metadata/form-versions/not-a-uuid",
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("FRM-07 — maker-checker publish", () => {
  it("submits a draft for approval and records the submitter", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/submit`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: "pending_approval", submittedBy: MAKER });
  });

  it("409 when submitting a version that is already awaiting approval", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    await app.inject({ method: "POST", url: `/v1/metadata/form-versions/${id}/submit`, headers: hdr(TENANT, MAKER), body: "{}" });
    const again = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/submit`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("INVALID_STATE");
  });

  it("THE SUBMITTER CANNOT APPROVE THEIR OWN FORM VERSION (403)", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    await app.inject({ method: "POST", url: `/v1/metadata/form-versions/${id}/submit`, headers: hdr(TENANT, MAKER), body: "{}" });

    const selfApprove = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/approve`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(selfApprove.statusCode).toBe(403);
    expect(selfApprove.json().error.code).toBe("MAKER_CANNOT_CHECK");

    // And the version is still pending — the refusal did not half-apply.
    const after = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${id}`,
      headers: hdr(TENANT, MAKER),
    });
    expect(after.json().data.status).toBe("pending_approval");
    expect(after.json().data.publishedAt).toBeNull();
  });

  it("a different actor can approve, and publish is recorded", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    await app.inject({ method: "POST", url: `/v1/metadata/form-versions/${id}/submit`, headers: hdr(TENANT, MAKER), body: "{}" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/approve`,
      headers: hdr(TENANT, CHECKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: "published", publishedBy: CHECKER });
    expect(res.json().data.publishedAt).toBeTruthy();
  });

  it("409 on a second approve; publishedBy is not re-stamped", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await publish(layoutId);
    const again = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/approve`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_PUBLISHED");
    const after = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${id}`,
      headers: hdr(TENANT, MAKER),
    });
    expect(after.json().data.publishedBy).toBe(CHECKER);
  });

  it("409 when approving a draft that was never submitted", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/approve`,
      headers: hdr(TENANT, CHECKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(409);
  });

  it("404 when approving an unknown version", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${randomUUID()}/approve`,
      headers: hdr(TENANT, CHECKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a pending version back to draft and clears the submitter", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    await app.inject({ method: "POST", url: `/v1/metadata/form-versions/${id}/submit`, headers: hdr(TENANT, MAKER), body: "{}" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/reject`,
      headers: hdr(TENANT, CHECKER),
      body: JSON.stringify({ reason: "cascade options incomplete" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: "draft", submittedBy: null });
  });

  it("409 when rejecting a draft", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/reject`,
      headers: hdr(TENANT, CHECKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(409);
  });

  it("400 when the reject reason is not a string", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/reject`,
      headers: hdr(TENANT, CHECKER),
      body: JSON.stringify({ reason: 42 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("publishing a new version supersedes the previous published one", async () => {
    const { layoutId } = await seedForm(TENANT);
    const first = await publish(layoutId);
    const second = await publish(layoutId);

    const firstAfter = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${first}`,
      headers: hdr(TENANT, MAKER),
    });
    expect(firstAfter.json().data.status).toBe("superseded");
    expect(firstAfter.json().data.supersededBy).toBe(second);
  });
});

describe("FRM-07 — a published version is IMMUTABLE", () => {
  it("409 VERSION_IMMUTABLE when patching a published version", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await publish(layoutId, {
      visibilityRules: [{ field: "gstin", showWhen: 'entity_type == "company"' }],
    });

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/metadata/form-versions/${id}`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ visibilityRules: [] }),
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe("VERSION_IMMUTABLE");

    // The stored definition is byte-for-byte what was approved.
    const after = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${id}`,
      headers: hdr(TENANT, MAKER),
    });
    expect(after.json().data.visibilityRules).toEqual([
      { field: "gstin", showWhen: 'entity_type == "company"' },
    ]);
  });

  it("409 when patching a version awaiting approval", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    await app.inject({ method: "POST", url: `/v1/metadata/form-versions/${id}/submit`, headers: hdr(TENANT, MAKER), body: "{}" });
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/metadata/form-versions/${id}`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ visibilityRules: [] }),
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe("VERSION_PENDING_APPROVAL");
  });

  it("a draft CAN be patched, and its rules are re-validated", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const ok = await app.inject({
      method: "PATCH",
      url: `/v1/metadata/form-versions/${id}`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ visibilityRules: [{ field: "gstin", showWhen: "entity_type == 1" }] }),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.version).toBe(2);

    const bad = await app.inject({
      method: "PATCH",
      url: `/v1/metadata/form-versions/${id}`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ visibilityRules: [{ field: "ghost", showWhen: "x == 1" }] }),
    });
    expect(bad.statusCode).toBe(422);
  });

  it("404 when patching an unknown version", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/metadata/form-versions/${randomUUID()}`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ visibilityRules: [] }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("REVISE creates a NEW DRAFT and leaves the published version untouched", async () => {
    const { layoutId } = await seedForm(TENANT);
    const published = await publish(layoutId, {
      visibilityRules: [{ field: "gstin", showWhen: 'entity_type == "company"' }],
    });

    const revise = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${published}/revise`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(revise.statusCode).toBe(201);
    const draft = revise.json().data;
    expect(draft.id).not.toBe(published);
    expect(draft.status).toBe("draft");
    expect(draft.versionNumber).toBe(2);
    // The copy carries the source definition forward.
    expect(draft.visibilityRules).toEqual([{ field: "gstin", showWhen: 'entity_type == "company"' }]);

    const publishedAfter = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${published}`,
      headers: hdr(TENANT, MAKER),
    });
    expect(publishedAfter.json().data.status).toBe("published");
  });

  it("404 when revising an unknown version", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${randomUUID()}/revise`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("FRM-04/FRM-05 — server-side resolve", () => {
  it("resolves cascade options and visibility from the values supplied", async () => {
    const { layoutId } = await seedForm(TENANT, [
      { apiName: "state", required: true },
      { apiName: "district", required: false },
    ]);
    const id = await createDraft(layoutId, {
      cascadeRules: [
        { field: "district", dependsOn: "state", options: { MH: ["Pune", "Nagpur"], KA: ["Mysuru"] } },
      ],
    });

    const empty = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/resolve`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ values: {} }),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.cascades[0]).toMatchObject({ field: "district", parentValue: null, options: [] });

    const chosen = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/resolve`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ values: { state: "MH" } }),
    });
    expect(chosen.json().data.cascades[0].options).toEqual(["Pune", "Nagpur"]);
  });

  it("reports hidden fields and which submitted values would be stripped", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId, {
      visibilityRules: [{ field: "gstin", showWhen: 'entity_type == "company"' }],
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/resolve`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ values: { entity_type: "individual", gstin: "spoofed" } }),
    });
    expect(res.json().data.hidden).toEqual(["gstin"]);
    expect(res.json().data.stripped).toEqual(["gstin"]);
  });

  it("400 on an unexpected body key", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/resolve`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ values: {}, tenantId: OTHER_TENANT }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 for a role with no data access", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/resolve`,
      headers: hdr(TENANT, MAKER, ["citizen"]),
      body: JSON.stringify({ values: {} }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown version", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${randomUUID()}/resolve`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ values: {} }),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("LM-002 — minting a public endpoint", () => {
  it("422 for a version that is not published (a draft must not go on the internet)", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await createDraft(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/public-endpoints`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ label: "Campaign form" }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VERSION_NOT_PUBLISHED");
  });

  it("mints an unguessable 64-hex key for a published version", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await publish(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/public-endpoints`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ label: "Campaign form" }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(res.json().data.submitUrl).toContain(`/v1/metadata/public/tenants/${TENANT}/forms/`);
  });

  it("400 without a label", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await publish(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/public-endpoints`,
      headers: hdr(TENANT, MAKER),
      body: "{}",
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 for a non-admin role", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await publish(layoutId);
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${id}/public-endpoints`,
      headers: hdr(TENANT, MAKER, ["metadata_user"]),
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown version", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/form-versions/${randomUUID()}/public-endpoints`,
      headers: hdr(TENANT, MAKER),
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("LM-002 — reading captured leads", () => {
  it("returns an empty page for a version with no submissions", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await publish(layoutId);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${id}/submissions?limit=50`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });

  it("400 without limit", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await publish(layoutId);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${id}/submissions`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 for a role with no data access", async () => {
    const { layoutId } = await seedForm(TENANT);
    const id = await publish(layoutId);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${id}/submissions?limit=10`,
      headers: hdr(TENANT, MAKER, ["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown version", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${randomUUID()}/submissions?limit=10`,
      headers: hdr(TENANT, MAKER),
    });
    expect(res.statusCode).toBe(404);
  });
});
