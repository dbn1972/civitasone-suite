/**
 * Proof that the human-facing reference numbers (case_number, imported
 * definition code) are allocated from Postgres SEQUENCEs inside the insert
 * transaction (migrations/0047_reference_number_sequences.sql): no collisions
 * under 50-way concurrency, a retried command persists exactly once, and a
 * terminal failure leaves an audited failure record.
 */
process.env.WORKFLOW_DLQ_MAX_ATTEMPTS = "2";

import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerDefinitionConsumers } from "../src/modules/definitions/consumer.js";
import { registerCaseRegistryConsumers } from "../src/modules/case-registry/consumer.js";
import * as defRepo from "../src/modules/definitions/repo.js";
import * as caseRegistryRepo from "../src/modules/case-registry/repo.js";
import { persistSplit } from "../src/modules/case-links/repo.js";
import { istYear, formatNumber } from "../src/shared/numbers.js";
import { sqlAsTenant, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c1a50000-0000-4000-8000-000000000047";
const ACTOR = "c1a50000-0000-4000-8000-0000000000a1";
const CASE_RE = /^CASE-\d{4}-\d{6,}$/;
const BPMN_RE = /^BPMN-\d{4}-\d{6,}$/;
const N = 50;

const tok = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET);
const BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="def_1">
  <process id="Process_1" name="Seq Flow" isExecutable="true">
    <startEvent id="start_1" name="Start" />
    <userTask id="task_1" name="Review" />
    <endEvent id="end_1" name="Done" />
    <sequenceFlow id="f1" sourceRef="start_1" targetRef="task_1" />
    <sequenceFlow id="f2" sourceRef="task_1" targetRef="end_1" />
  </process>
</definitions>`;

registerDefinitionConsumers(queue);
registerCaseRegistryConsumers(queue);
await queue.start();

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 20000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

const caseNumbers = async (): Promise<string[]> =>
  (await sqlAsTenant<{ case_number: string }>(TENANT, sql`SELECT case_number FROM workflow.cases WHERE tenant_id = ${TENANT}`)).map((r) => r.case_number);
const definitionCodes = async (): Promise<string[]> =>
  (await sqlAsTenant<{ code: string }>(TENANT, sql`SELECT code FROM workflow.definitions WHERE tenant_id = ${TENANT}`)).map((r) => r.code);
const auditFailures = (corr: string) =>
  sqlAsTenant<{ payload: Record<string, any> }>(TENANT, sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${corr}`);

afterEach(async () => {
  vi.restoreAllMocks();
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.case_links WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.cases WHERE tenant_id = ${TENANT}`);
  await cleanup(TENANT);
});
afterAll(async () => { await sqlClient.end(); });

describe("formatting", () => {
  it("year is IST, number is zero-padded", () => {
    // 2026-12-31T20:00Z is already 2027-01-01 in IST.
    expect(istYear(new Date("2026-12-31T20:00:00Z"))).toBe(2027);
    expect(formatNumber("CASE", 2026, 123)).toBe("CASE-2026-000123");
  });
});

describe(`no collisions under ${N}-way concurrency`, () => {
  it("case_number via POST /v1/workflow/cases", async () => {
    const app = await buildApp();
    const results = await Promise.all(Array.from({ length: N }, (_, i) =>
      app.inject({
        method: "POST", url: "/v1/workflow/cases", headers: { authorization: `Bearer ${tok(["case_manager"])}` },
        payload: { title: `C${i}`, caseType: "generic", sourceService: "seqtest", sourceRefId: randomUUID() },
      })));
    await app.close();
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = await caseNumbers();
    expect(numbers.length).toBe(N);
    expect(new Set(numbers).size).toBe(N);
    for (const n of numbers) expect(n).toMatch(CASE_RE);
  });

  it("case_number via the async domain-event consumer (202 path)", async () => {
    await Promise.all(Array.from({ length: N }, () => {
      const id = randomUUID();
      return queue.publish("workflow.case.create", {
        messageId: randomUUID(), type: "workflow.case.create", tenantId: TENANT, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, tenantId: TENANT, title: "async case" },
      });
    }));
    const numbers = await waitFor(async () => { const n = await caseNumbers(); return n.length === N ? n : null; });
    expect(new Set(numbers).size).toBe(N);
    for (const n of numbers) expect(n).toMatch(CASE_RE);
  });

  it("split child case_number", async () => {
    const parents: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = await runWithTenant(TENANT, () => caseRegistryRepo.registerCase({
        tenantId: TENANT, title: `P${i}`, caseType: "generic", sourceService: "seqtest", sourceRefId: randomUUID(),
        actorId: ACTOR, correlationId: randomUUID(),
      }));
      parents.push(r.id);
    }
    await Promise.all(parents.map((parentCaseId) => runWithTenant(TENANT, () => persistSplit({
      tenantId: TENANT, parentCaseId, children: [{ title: "child", caseType: "generic" }], actorId: ACTOR, correlationId: randomUUID(),
    }))));
    const numbers = await caseNumbers();
    expect(numbers.length).toBe(N * 2);
    expect(new Set(numbers).size).toBe(N * 2);
    for (const n of numbers) expect(n).toMatch(CASE_RE);
  });

  it("imported definition code via POST /v1/workflow/definitions/import", async () => {
    const app = await buildApp();
    const results = await Promise.all(Array.from({ length: N }, () =>
      app.inject({
        method: "POST", url: "/v1/workflow/definitions/import", headers: { authorization: `Bearer ${tok(["workflow_admin"])}` },
        payload: { xml: BPMN_XML, name: "Seq Flow" },
      })));
    await app.close();
    expect(results.every((r) => r.statusCode === 202)).toBe(true);
    const codes = await waitFor(async () => { const c = await definitionCodes(); return c.length === N ? c : null; });
    expect(new Set(codes).size).toBe(N);
    for (const c of codes) expect(c).toMatch(BPMN_RE);
  });
});

describe("a retried command persists exactly once", () => {
  it("BPMN import: first attempt fails after the number was allocated, the retry re-allocates and commits once", async () => {
    const real = defRepo.insertGraphTx;
    let calls = 0;
    vi.spyOn(defRepo, "insertGraphTx").mockImplementation(async (...args: Parameters<typeof real>) => {
      calls += 1;
      if (calls === 1) throw new Error("transient failure after nextval");
      return real(...args);
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/workflow/definitions/import", headers: { authorization: `Bearer ${tok(["workflow_admin"])}` },
      payload: { xml: BPMN_XML, name: "Retry Flow" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await waitFor(async () => (await definitionCodes()).length > 0);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBeGreaterThanOrEqual(2);
    const rows = await sqlAsTenant<{ id: string; code: string }>(TENANT, sql`SELECT id, code FROM workflow.definitions WHERE tenant_id = ${TENANT}`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.code).toMatch(BPMN_RE);
  });

  it("case registration: first attempt fails after the number was allocated, the retry commits once", async () => {
    const real = caseRegistryRepo.registerCaseTx;
    let calls = 0;
    vi.spyOn(caseRegistryRepo, "registerCaseTx").mockImplementation(async (tx, input) => {
      calls += 1;
      const out = await real(tx, input); // allocates the number and inserts...
      if (calls === 1) throw new Error("transient failure after nextval"); // ...then the transaction rolls back
      return out;
    });
    const id = randomUUID();
    await queue.publish("workflow.case.create", {
      messageId: randomUUID(), type: "workflow.case.create", tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, tenantId: TENANT, title: "retried case" },
    });
    await waitFor(async () => (await caseNumbers()).length > 0);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(2);
    const numbers = await caseNumbers();
    expect(numbers.length).toBe(1);
    expect(numbers[0]).toMatch(CASE_RE);
  });
});

describe("terminal failure is audited, never silent", () => {
  it("BPMN import that fails on every attempt leaves an audit.event.record outcome=failure", async () => {
    const messageId = randomUUID();
    await queue.publish(COMMANDS.importBpmnDefinition, {
      messageId, type: COMMANDS.importBpmnDefinition, tenantId: TENANT, actorId: ACTOR,
      correlationId: messageId, schemaVersion: "1.0",
      payload: { id: "not-a-uuid", tenantId: TENANT, name: "x", nodes: [], edges: [] },
    });
    const rows = await waitFor(async () => { const r = await auditFailures(messageId); return r.length ? r : null; });
    expect(rows.length).toBe(1);
    expect(rows[0]!.payload.outcome).toBe("failure");
    expect(rows[0]!.payload.action).toBe("bpmn_import");
    expect(await definitionCodes()).toEqual([]);
  });

  it("case registration that fails on every attempt leaves an audit.event.record outcome=failure", async () => {
    const messageId = randomUUID();
    await queue.publish("workflow.case.create", {
      messageId, type: "workflow.case.create", tenantId: TENANT, actorId: ACTOR, correlationId: messageId, schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT, title: "x".repeat(300) }, // varchar(256): fails on every attempt
    });
    const rows = await waitFor(async () => { const r = await auditFailures(messageId); return r.length ? r : null; });
    expect(rows.length).toBe(1);
    expect(rows[0]!.payload.outcome).toBe("failure");
    expect(rows[0]!.payload.action).toBe("register");
    expect(await caseNumbers()).toEqual([]);
  });
});

describe("migration 0047 seeding and constraints", () => {
  const migrationSql = readFileSync(fileURLToPath(new URL("../migrations/0047_reference_number_sequences.sql", import.meta.url)), "utf8");
  const SEEDED = "CASE-2026-900000";

  async function runMigrationFile() {
    // The file carries its own BEGIN/COMMIT: run it on ONE reserved connection (the migration runner shape).
    const conn = await sqlClient.reserve();
    try { await conn.unsafe(migrationSql); } finally { conn.release(); }
  }
  const insertCase = (number: string) => sqlAsTenant(TENANT, sql`INSERT INTO workflow.cases (id, tenant_id, case_number, title, case_type, source_service, source_ref_id, created_by)
    VALUES (${randomUUID()}, ${TENANT}, ${number}, 't', 'generic', 'seqtest', ${randomUUID()}, ${ACTOR})`);

  it("re-running after rows exist seeds past the highest number, never rewinds, and keeps FORCE RLS", async () => {
    const before = await sqlClient.unsafe(`SELECT relname, relforcerowsecurity FROM pg_class WHERE oid IN ('workflow.cases'::regclass, 'workflow.definitions'::regclass) ORDER BY relname`);
    await insertCase(SEEDED);
    await runMigrationFile();
    const n1 = Number((await sqlClient.unsafe(`SELECT nextval('workflow.case_number_seq')::bigint AS n`))[0]!.n);
    expect(n1).toBeGreaterThan(900000);
    await runMigrationFile();
    const n2 = Number((await sqlClient.unsafe(`SELECT nextval('workflow.case_number_seq')::bigint AS n`))[0]!.n);
    expect(n2).toBeGreaterThan(n1);
    const after = await sqlClient.unsafe(`SELECT relname, relforcerowsecurity FROM pg_class WHERE oid IN ('workflow.cases'::regclass, 'workflow.definitions'::regclass) ORDER BY relname`);
    expect(after.map((r) => [r.relname, r.relforcerowsecurity])).toEqual(before.map((r) => [r.relname, r.relforcerowsecurity]));
    expect(after.some((r) => r.relforcerowsecurity === true)).toBe(true);
  });

  it("the UNIQUE index makes a duplicate sequence-format number impossible to persist", async () => {
    await insertCase("CASE-2026-900001");
    await expect(insertCase("CASE-2026-900001")).rejects.toThrow();
  });
});
