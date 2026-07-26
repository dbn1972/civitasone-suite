/**
 * Integration tests for the (now real) metadata-service against a live Postgres
 * with RLS ENABLE+FORCE and a NOBYPASSRLS role.
 *
 * Covers: CAP-016 (master data), CAP-109 (layouts), CAP-112 (entity/field/rule
 * model), CAP-113 (formula persistence + eval), CAP-116 (custom fields/records),
 * plus maker-checker on publish and runtime tenant isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const A_TENANT = randomUUID();
const B_TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();

function token(tid: string, actor: string, roles: string[] = ["metadata_admin"]): string {
  return signToken({ sub: actor, tid, roles, sid: "sess" }, SECRET);
}
function hdr(tid: string, actor: string, roles?: string[]) {
  return { authorization: `Bearer ${token(tid, actor, roles)}`, "content-type": "application/json" };
}

async function seedEntity(tid: string, apiName: string, createdBy = MAKER): Promise<string> {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
    await sql`INSERT INTO metadata.entity_definitions
      (id, tenant_id, api_name, label, plural_label, created_by, updated_by)
      VALUES (${id}, ${tid}, ${apiName}, ${apiName}, ${apiName}, ${createdBy}, ${createdBy})`;
  });
  return id;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  for (const tid of [A_TENANT, B_TENANT]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
      await sql`DELETE FROM metadata.custom_records WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.validation_rules WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.field_definitions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.layout_definitions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.module_compositions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.formula_definitions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.entity_definitions WHERE tenant_id = ${tid}`;
    });
  }
  await sqlClient.end();
});

describe("auth + formula engine (CAP-113)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/metadata/formula/evaluate", headers: { "content-type": "application/json" }, body: JSON.stringify({ expression: "1+1" }) });
    expect(res.statusCode).toBe(401);
  });

  it("evaluates an ad-hoc formula", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/metadata/formula/evaluate", headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ expression: "qty * price", context: { qty: 3, price: 4 } }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.result).toBe(12);
  });

  it("400 on malformed formula", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/metadata/formula/evaluate", headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ expression: "1 + )" }) });
    expect(res.statusCode).toBe(400);
  });

  it("persists, lists and evaluates a stored formula", async () => {
    const apiName = `line_total_${Math.floor(Math.random() * 1e6)}`;
    const create = await app.inject({ method: "POST", url: "/v1/metadata/formula", headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ apiName, label: "Line total", expression: "qty * price" }) });
    expect(create.statusCode).toBe(201);
    const id = create.json().data.id;

    const list = await app.inject({ method: "GET", url: "/v1/metadata/formula", headers: hdr(A_TENANT, MAKER) });
    expect(list.json().data.some((f: { id: string }) => f.id === id)).toBe(true);

    const evalRes = await app.inject({ method: "POST", url: `/v1/metadata/formula/${id}/evaluate`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ context: { qty: 5, price: 2 } }) });
    expect(evalRes.statusCode).toBe(200);
    expect(evalRes.json().data.result).toBe(10);
  });
});

describe("custom fields (CAP-116) + master-data records (CAP-016)", () => {
  it("rejects a field on a non-existent entity", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/metadata/entities/${randomUUID()}/fields`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ apiName: "x", label: "X", fieldType: "text" }) });
    expect(res.statusCode).toBe(404);
  });

  it("defines fields, a rule, then validates records on write", async () => {
    const entityId = await seedEntity(A_TENANT, `asset_${Math.floor(Math.random() * 1e6)}`);

    const f1 = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/fields`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ apiName: "name", label: "Name", fieldType: "text", isRequired: true }) });
    expect(f1.statusCode).toBe(201);
    const f2 = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/fields`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ apiName: "amount", label: "Amount", fieldType: "number", isRequired: true }) });
    expect(f2.statusCode).toBe(201);

    const rule = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/validation-rules`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ name: "amount_positive", expression: "amount > 0", errorMessage: "Amount must be positive" }) });
    expect(rule.statusCode).toBe(201);

    const listFields = await app.inject({ method: "GET", url: `/v1/metadata/entities/${entityId}/fields`, headers: hdr(A_TENANT, MAKER) });
    expect(listFields.json().meta.total).toBe(2);

    // Invalid: missing required name + negative amount → 422, not persisted.
    const bad = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/records`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ data: { amount: -5 } }) });
    expect(bad.statusCode).toBe(422);

    // Valid record → 201.
    const good = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/records`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ data: { name: "Truck", amount: 100 } }) });
    expect(good.statusCode).toBe(201);
    const recId = good.json().data.id;

    const get = await app.inject({ method: "GET", url: `/v1/metadata/records/${recId}`, headers: hdr(A_TENANT, MAKER) });
    expect(get.json().data.data.name).toBe("Truck");

    // Patch that would break the rule → 422.
    const badPatch = await app.inject({ method: "PATCH", url: `/v1/metadata/records/${recId}`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ data: { amount: -1 } }) });
    expect(badPatch.statusCode).toBe(422);

    const okPatch = await app.inject({ method: "PATCH", url: `/v1/metadata/records/${recId}`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ data: { amount: 250 } }) });
    expect(okPatch.statusCode).toBe(200);
    expect(okPatch.json().data.data.amount).toBe(250);

    const del = await app.inject({ method: "DELETE", url: `/v1/metadata/records/${recId}`, headers: hdr(A_TENANT, MAKER) });
    expect(del.statusCode).toBe(200);
  });
});

describe("form / layout builder (CAP-109)", () => {
  it("rejects a layout referencing unknown fields, accepts known ones", async () => {
    const entityId = await seedEntity(A_TENANT, `form_${Math.floor(Math.random() * 1e6)}`);
    await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/fields`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ apiName: "title", label: "Title", fieldType: "text" }) });

    const bad = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/layouts`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ sections: [{ label: "Main", fields: ["ghost"] }] }) });
    expect(bad.statusCode).toBe(422);

    const ok = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/layouts`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ sections: [{ label: "Main", fields: ["title"] }], isDefault: true }) });
    expect(ok.statusCode).toBe(201);
  });
});

describe("maker-checker on publish", () => {
  it("entity author cannot publish; a different admin can", async () => {
    const entityId = await seedEntity(A_TENANT, `pub_${Math.floor(Math.random() * 1e6)}`, MAKER);

    const selfPublish = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/publish`, headers: hdr(A_TENANT, MAKER), body: "{}" });
    expect(selfPublish.statusCode).toBe(403);
    expect(selfPublish.json().code).toBe("MAKER_CANNOT_CHECK");

    const checkerPublish = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/publish`, headers: hdr(A_TENANT, CHECKER), body: "{}" });
    expect(checkerPublish.statusCode).toBe(200);
    expect(checkerPublish.json().data.publishedAt).toBeTruthy();

    const again = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/publish`, headers: hdr(A_TENANT, CHECKER), body: "{}" });
    expect(again.statusCode).toBe(409);
  });

  it("composition author cannot publish it (CAP-111/114)", async () => {
    const entApi = `compent_${Math.floor(Math.random() * 1e6)}`;
    const entityId = await seedEntity(A_TENANT, entApi, MAKER);
    const layout = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/layouts`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ sections: [{ label: "S", fields: [] }] }) });
    const layoutId = layout.json().data.id;

    const create = await app.inject({ method: "POST", url: "/v1/metadata/compositions", headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ apiName: `mod_${Math.floor(Math.random() * 1e6)}`, label: "Fleet", definition: { entities: [entApi], layouts: [{ entity: entApi, layoutId }] } }) });
    expect(create.statusCode).toBe(201);
    const compId = create.json().data.id;
    expect(create.json().data.status).toBe("draft");

    const self = await app.inject({ method: "POST", url: `/v1/metadata/compositions/${compId}/publish`, headers: hdr(A_TENANT, MAKER), body: "{}" });
    expect(self.statusCode).toBe(403);

    const checker = await app.inject({ method: "POST", url: `/v1/metadata/compositions/${compId}/publish`, headers: hdr(A_TENANT, CHECKER), body: "{}" });
    expect(checker.statusCode).toBe(200);
    expect(checker.json().data.status).toBe("published");
  });

  it("re-publishing an already-published composition returns 409 and does not change publishedAt/publishedBy", async () => {
    const entApi = `compent_${Math.floor(Math.random() * 1e6)}`;
    const entityId = await seedEntity(A_TENANT, entApi, MAKER);
    const layout = await app.inject({ method: "POST", url: `/v1/metadata/entities/${entityId}/layouts`, headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ sections: [{ label: "S", fields: [] }] }) });
    const layoutId = layout.json().data.id;

    const create = await app.inject({ method: "POST", url: "/v1/metadata/compositions", headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ apiName: `mod_${Math.floor(Math.random() * 1e6)}`, label: "Fleet", definition: { entities: [entApi], layouts: [{ entity: entApi, layoutId }] } }) });
    const compId = create.json().data.id;

    const first = await app.inject({ method: "POST", url: `/v1/metadata/compositions/${compId}/publish`, headers: hdr(A_TENANT, CHECKER), body: "{}" });
    expect(first.statusCode).toBe(200);
    const publishedAt = first.json().data.publishedAt;
    const publishedBy = first.json().data.publishedBy;

    const second = await app.inject({ method: "POST", url: `/v1/metadata/compositions/${compId}/publish`, headers: hdr(A_TENANT, CHECKER), body: "{}" });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("ALREADY_PUBLISHED");

    const after = await app.inject({ method: "GET", url: `/v1/metadata/compositions/${compId}`, headers: hdr(A_TENANT, CHECKER) });
    expect(after.json().data.publishedAt).toBe(publishedAt);
    expect(after.json().data.publishedBy).toBe(publishedBy);
  });

  it("rejects a composition referencing an unknown entity", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/metadata/compositions", headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ apiName: `bad_${Math.floor(Math.random() * 1e6)}`, label: "Bad", definition: { entities: ["does_not_exist"] } }) });
    expect(create.statusCode).toBe(422);
  });
});

describe("config preview / dry-run (CAP-117)", () => {
  it("previews a field change without persisting", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/metadata/config/preview", headers: hdr(A_TENANT, MAKER), body: JSON.stringify({ kind: "field", field: { apiName: "score", fieldType: "number", isRequired: true }, sampleRecords: [{ score: 10 }, { score: "x" }] }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.wouldPersist).toBe(false);
    expect(res.json().data.summary).toMatchObject({ passing: 1, failing: 1 });
  });
});

describe("runtime tenant isolation (RLS)", () => {
  it("does not leak entities across tenants", async () => {
    const apiName = `iso_${Math.floor(Math.random() * 1e6)}`;
    const entityId = await seedEntity(A_TENANT, apiName, MAKER);

    const asA = await app.inject({ method: "GET", url: "/v1/metadata/entities", headers: hdr(A_TENANT, MAKER) });
    expect(asA.json().data.some((e: { id: string }) => e.id === entityId)).toBe(true);

    const asB = await app.inject({ method: "GET", url: "/v1/metadata/entities", headers: hdr(B_TENANT, MAKER) });
    expect(asB.json().data.some((e: { id: string }) => e.id === entityId)).toBe(false);

    // B cannot read A's fields either.
    const bFields = await app.inject({ method: "GET", url: `/v1/metadata/entities/${entityId}/fields`, headers: hdr(B_TENANT, MAKER) });
    expect(bFields.json().meta.total).toBe(0);
  });
});
