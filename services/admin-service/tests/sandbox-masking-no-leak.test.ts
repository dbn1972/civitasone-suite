/**
 * WC-009 — proof that the masked-refresh surface cannot leak a source VALUE.
 *
 * The brief asks for a test that "masked output cannot leak the original value".
 * The honest framing is structural rather than behavioural, because THERE IS NO
 * DATA MOVEMENT IN THIS BUILD: `copyMaskedData()` in modules/sandbox/consumer.ts
 * is an explicit stub that performs no I/O, so there is no masked output to
 * compare against an original. Asserting `mask(value) !== value` would be
 * theatre — it would exercise a function that does not exist.
 *
 * What CAN be proved, and is proved here, is the property that makes a leak
 * impossible once the stub is implemented: every type on the path from request
 * to persisted record to API response carries field NAMES and STRATEGIES ONLY.
 * No request accepts a value, no row stores one, no response returns one. So
 * these tests pin the exact key sets of the three shapes an implementer could
 * be tempted to widen, plus the fail-closed default that makes an unconfigured
 * field masked rather than passed through.
 *
 * If someone later adds a `sampleValue` or `before`/`after` field to any of
 * these shapes, these tests fail — which is the point.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { handleSandboxRefreshExecute } = await import("../src/modules/sandbox/consumer.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "1eac0000-0000-4000-8000-0000000000e1";
const MAKER = "1eac1111-0000-4000-8000-0000000000e2";
const CHECKER = "1eac2222-0000-4000-8000-0000000000e3";

function auth(actorId: string): { authorization: string } {
  return {
    authorization: `Bearer ${signToken({ sub: actorId, tid: TENANT, roles: ["tenant_admin"], sid: "sess-leak" }, SECRET, 3600)}`,
  };
}

function asTenant<T>(run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  await asTenant(async (sql) => {
    await sql`DELETE FROM sandbox.refresh_masked_fields WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM sandbox.refresh_jobs WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM sandbox.masking_rules WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM sandbox.sandbox_environments WHERE tenant_id = ${TENANT}`;
  });
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

interface PlannedField {
  tableName: string; fieldName: string; strategy: string; ruleSource: string; masked: boolean;
}
interface JobResponse {
  id: string; version: number; dataMovement: string;
  requestedFields: Array<Record<string, unknown>>;
  plan: {
    fields: PlannedField[];
    maskedFieldCount: number;
    preservedFieldCount: number;
    defaultedFields: Array<Record<string, unknown>>;
  };
}

/** One rule per masking strategy, so every branch is represented end to end. */
const RULES: Array<[string, string, string, string]> = [
  ["citizens", "email", "hash", "pseudonymised for join integrity"],
  ["citizens", "phone", "partial", "last four digits kept for support triage"],
  ["citizens", "aadhaar", "redact", "never leaves production"],
  ["citizens", "bank_account", "nullify", "not needed in sandbox at all"],
  ["citizens", "district", "preserve", "public administrative geography, not personal data"],
];

/** Deliberately includes `pan`, for which NO rule exists — must fail closed. */
const FIELDS = [
  { tableName: "citizens", fieldName: "email" },
  { tableName: "citizens", fieldName: "phone" },
  { tableName: "citizens", fieldName: "aadhaar" },
  { tableName: "citizens", fieldName: "bank_account" },
  { tableName: "citizens", fieldName: "district" },
  { tableName: "citizens", fieldName: "pan" },
];

let sandboxId = "";
let job: JobResponse;

beforeAll(async () => {
  const reg = await app.inject({
    method: "POST", url: "/v1/admin/sandboxes", headers: auth(MAKER),
    payload: { code: "leak-probe", name: "Leak probe", sourceEnvironment: "production" },
  });
  expect(reg.statusCode).toBe(201);
  sandboxId = (reg.json() as { data: { id: string } }).data.id;

  for (const [tableName, fieldName, strategy, justification] of RULES) {
    const r = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandboxId}/masking-rules`, headers: auth(MAKER),
      payload: { tableName, fieldName, strategy, justification },
    });
    expect(r.statusCode).toBe(201);
  }

  const req = await app.inject({
    method: "POST", url: `/v1/admin/sandboxes/${sandboxId}/refreshes`, headers: auth(MAKER),
    payload: { requestedFields: FIELDS },
  });
  expect(req.statusCode).toBe(201);
  job = (req.json() as { data: JobResponse }).data;

  const approved = await app.inject({
    method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`, headers: auth(CHECKER),
    payload: { expectedVersion: job.version },
  });
  expect(approved.statusCode).toBe(202);

  await handleSandboxRefreshExecute({
    messageId: randomUUID(),
    tenantId: TENANT,
    actorId: CHECKER,
    correlationId: "corr-leak",
    payload: { jobId: job.id, sandboxId, tenantId: TENANT },
  });
});

describe("WC-009 masking surface — carries names and strategies, never values", () => {
  it("the planned field shape has exactly the value-free key set", () => {
    for (const field of job.plan.fields) {
      expect(Object.keys(field).sort()).toEqual(
        ["fieldName", "masked", "ruleSource", "strategy", "tableName"],
      );
    }
  });

  it("the echoed requestedFields carry only a table and a field name", () => {
    for (const field of job.requestedFields) {
      expect(Object.keys(field).sort()).toEqual(["fieldName", "tableName"]);
    }
  });

  it("defaultedFields identify the unconfigured field by name only", () => {
    expect(job.plan.defaultedFields).toEqual([{ tableName: "citizens", fieldName: "pan" }]);
  });

  it("the persisted masked-field record has no value column populated", async () => {
    const rows = await asTenant((sql) => sql<Array<Record<string, unknown>>>`
      SELECT * FROM sandbox.refresh_masked_fields WHERE job_id = ${job.id} ORDER BY field_name`);
    expect(rows.length).toBe(FIELDS.length);
    const columns = Object.keys(rows[0] ?? {});
    // The table is allowed to describe the field and how it was treated, and to
    // carry the standard entity/audit columns — nothing that could hold data.
    expect(columns.sort()).toEqual([
      "created_at", "created_by", "field_name", "id", "job_id", "rule_source",
      "strategy", "table_name", "tenant_id", "updated_at", "updated_by", "version",
    ]);
  });

  it("the masked-fields API response exposes only field name, strategy and provenance", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}/masked-fields?limit=200`,
      headers: auth(CHECKER),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };
    expect(body.meta.total).toBe(FIELDS.length);
    for (const row of body.data) {
      expect(Object.keys(row).sort()).toEqual(["fieldName", "ruleSource", "strategy", "tableName"]);
    }
  });

  it("records the configured strategy for every rule type, and redact for the unruled field", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}/masked-fields?limit=200`,
      headers: auth(CHECKER),
    });
    const rows = (res.json() as { data: Array<{ fieldName: string; strategy: string; ruleSource: string }> }).data;
    const byField = new Map(rows.map((r) => [r.fieldName, r]));

    expect(byField.get("email")).toMatchObject({ strategy: "hash", ruleSource: "rule" });
    expect(byField.get("phone")).toMatchObject({ strategy: "partial", ruleSource: "rule" });
    expect(byField.get("aadhaar")).toMatchObject({ strategy: "redact", ruleSource: "rule" });
    expect(byField.get("bank_account")).toMatchObject({ strategy: "nullify", ruleSource: "rule" });
    expect(byField.get("district")).toMatchObject({ strategy: "preserve", ruleSource: "rule" });
    // The whole point of fail-closed: nobody configured `pan`, so it is masked.
    expect(byField.get("pan")).toMatchObject({ strategy: "redact", ruleSource: "default" });
  });

  it("`preserve` is the only way a field is counted as unmasked", async () => {
    const row = await asTenant(async (sql) => {
      const rows = await sql<Array<{ masked_field_count: number; preserved_field_count: number; data_movement: string }>>`
        SELECT masked_field_count, preserved_field_count, data_movement
        FROM sandbox.refresh_jobs WHERE id = ${job.id}`;
      return rows[0];
    });
    // 6 requested fields, exactly one of which has an explicit `preserve` rule.
    expect(row?.preserved_field_count).toBe(1);
    expect(row?.masked_field_count).toBe(5);
    // And nothing was actually copied — the stub is still a stub.
    expect(row?.data_movement).toBe("stubbed");
  });

  it("no response on the sandbox read path echoes anything but identifiers and metadata", async () => {
    const jobRes = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}`, headers: auth(CHECKER),
    });
    const body = jobRes.json() as { data: Record<string, unknown> };
    // A value-bearing key would have to be introduced deliberately; assert the
    // known key set so an addition is caught by review, not by an incident.
    expect(Object.keys(body.data).sort()).toEqual([
      "approvedAt", "approvedBy", "completedAt", "createdAt", "dataMovement",
      "failureReason", "id", "maskedFieldCount", "preservedFieldCount",
      "rejectedReason", "requestedBy", "requestedFields", "sandboxId",
      "sourceEnvironment", "startedAt", "status", "version",
    ]);
  });
});
