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
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerSandboxConsumers, handleSandboxRefreshExecute } = await import("../src/modules/sandbox/consumer.js");
const { registerF3_sandbox_Consumers } = await import("../src/modules/sandbox/f3-consumer.js");

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
beforeAll(async () => {
  // register/masking-rule/refresh-request/approve were converted to F3 async
  // (202) — same "one consumer per shared-topic test file" workaround as
  // tests/sandbox-routes.test.ts (see that file's beforeAll comment for the
  // full writeup of the shared admin.f3.route_write topic + MemoryQueue
  // per-message dedup issue, out of this batch's scope). registerSandboxConsumers
  // is registered bare (not tenantScoped) to match worker.ts, even though this
  // file never uses it via the queue — handleSandboxRefreshExecute is invoked
  // directly below, bypassing the queue entirely, so it's included only for
  // parity/documentation, not because this file depends on it firing.
  registerSandboxConsumers(queue);
  registerF3_sandbox_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

interface MaskedFieldRow { fieldName: string; tableName: string; strategy: string; ruleSource: string }
interface JobDetail {
  id: string; version: number; dataMovement: string;
  requestedFields: Array<Record<string, unknown>>;
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
let job: JobDetail;
/**
 * The masking PLAN (fields[]/defaultedFields/masked booleans) was only ever
 * in the old synchronous refresh-request response body — sandbox/f3-apply.ts's
 * apply_sandbox_2 computes it entirely inside the async consumer and never
 * echoes it anywhere the 202 response or a later GET can surface (same class
 * of "computed-and-discarded" gap as tests/config-artefacts-routes.test.ts's
 * approve() and tests/security-incident.test.ts's onTime). Every assertion
 * below that used to read `job.plan.*` now sources the same information from
 * GET .../masked-fields (the PERSISTED per-field strategy/ruleSource, which
 * the module's read path always exposed and is unaffected by the 202
 * conversion) — `masked` is `strategy !== "preserve"`, and a defaulted field
 * is exactly one whose `ruleSource === "default"`.
 */
let maskedFields: MaskedFieldRow[] = [];

beforeAll(async () => {
  const reg = await app.inject({
    method: "POST", url: "/v1/admin/sandboxes", headers: auth(MAKER),
    payload: { code: "leak-probe", name: "Leak probe", sourceEnvironment: "production" },
  });
  expect(reg.statusCode).toBe(202);
  await (queue as any).drain?.();
  // sandbox/f3-apply.ts's apply_sandbox_0 never forwards the route-generated
  // id into repo.insertSandbox() — same class of bug documented in
  // tests/sandbox-routes.test.ts's register() (real, pre-existing, out of
  // this batch's scope). Look the real row up by its unique code.
  const sandboxes = await app.inject({ method: "GET", url: "/v1/admin/sandboxes?limit=200", headers: auth(MAKER) });
  const sandboxRow = (sandboxes.json() as { data: Array<{ id: string; code: string }> }).data
    .find((r) => r.code === "leak-probe");
  if (!sandboxRow) throw new Error("sandbox 'leak-probe' never landed");
  sandboxId = sandboxRow.id;

  for (const [tableName, fieldName, strategy, justification] of RULES) {
    const r = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandboxId}/masking-rules`, headers: auth(MAKER),
      payload: { tableName, fieldName, strategy, justification },
    });
    expect(r.statusCode).toBe(202);
    await (queue as any).drain?.();
  }

  const req = await app.inject({
    method: "POST", url: `/v1/admin/sandboxes/${sandboxId}/refreshes`, headers: auth(MAKER),
    payload: { requestedFields: FIELDS },
  });
  expect(req.statusCode).toBe(202);
  await (queue as any).drain?.();
  // Jobs have no natural unique business key — this beforeAll creates
  // exactly one pending job for this sandbox, so the newest
  // pending_approval job for sandboxId is unambiguously the one just
  // created (same technique as tests/sandbox-routes.test.ts's requestRefresh()).
  const jobs = await app.inject({
    method: "GET", url: `/v1/admin/sandbox-refreshes?limit=1&status=pending_approval&sandboxId=${sandboxId}`,
    headers: auth(MAKER),
  });
  const jobRow = (jobs.json() as { data: JobDetail[] }).data[0];
  if (!jobRow) throw new Error(`refresh request for sandbox ${sandboxId} never landed`);
  job = jobRow;

  const approved = await app.inject({
    method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`, headers: auth(CHECKER),
    payload: { expectedVersion: job.version },
  });
  expect(approved.statusCode).toBe(202);
  await (queue as any).drain?.();

  await handleSandboxRefreshExecute({
    messageId: randomUUID(),
    tenantId: TENANT,
    actorId: CHECKER,
    correlationId: "corr-leak",
    payload: { jobId: job.id, sandboxId, tenantId: TENANT },
  });

  const maskedFieldsRes = await app.inject({
    method: "GET", url: `/v1/admin/sandbox-refreshes/${job.id}/masked-fields?limit=200`, headers: auth(CHECKER),
  });
  maskedFields = (maskedFieldsRes.json() as { data: MaskedFieldRow[] }).data;
});

describe("WC-009 masking surface — carries names and strategies, never values", () => {
  it("the planned field shape has exactly the value-free key set", () => {
    for (const field of maskedFields) {
      expect(Object.keys(field).sort()).toEqual(
        ["fieldName", "ruleSource", "strategy", "tableName"],
      );
    }
  });

  it("the echoed requestedFields carry only a table and a field name", () => {
    for (const field of job.requestedFields) {
      expect(Object.keys(field).sort()).toEqual(["fieldName", "tableName"]);
    }
  });

  it("defaultedFields identify the unconfigured field by name only", () => {
    const defaulted = maskedFields
      .filter((f) => f.ruleSource === "default")
      .map((f) => ({ tableName: f.tableName, fieldName: f.fieldName }));
    expect(defaulted).toEqual([{ tableName: "citizens", fieldName: "pan" }]);
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
