/**
 * Contract test: the hr_employee fixtures from packages/scan-link (shared with document-service) are
 * accepted by the hrms consumers, and the emitted result events parse with the scan-link zod schemas
 * and have the fixture result shape.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import {
  LINK_TOPICS, scanLinkFixtures, FIXTURE_IDS, linkResultSchema, unlinkResultSchema,
  linkRequestFixture, unlinkRequestFixture,
} from "@civitasone/scan-link";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerScanLinkConsumers } from "../src/modules/employee/scan-link-consumer.js";

registerScanLinkConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();

const T = "5ca11a00-0009-4000-8000-00000000000c";
const ACTOR = FIXTURE_IDS.requestedBy;
const DEPT = "5ca11a00-0009-4000-8000-0000000000d1";
const DESG = "5ca11a00-0009-4000-8000-0000000000d2";
const fx = scanLinkFixtures().hr_employee;
let db: postgres.Sql;

const asTenant = <R>(fn: (tx: postgres.TransactionSql) => Promise<R>): Promise<R> =>
  db.begin(async (tx) => { await tx.unsafe(`select set_config('app.tenant_id', '${T}', true)`); return fn(tx); });

async function send(topic: string, payload: unknown): Promise<void> {
  await runWithTenant(T, () => queue.publish(topic, {
    messageId: randomUUID(), type: topic, tenantId: T, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  } as never));
  await drain();
}
const results = async (topic: string): Promise<Array<Record<string, unknown>>> =>
  (await asTenant((tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T} AND topic = ${topic} ORDER BY created_at`)).map((r) => r.payload as Record<string, unknown>);

async function wipe(): Promise<void> {
  await asTenant(async (tx) => {
    await tx`DELETE FROM employee.hrms_employee_scanned_documents WHERE tenant_id = ${T}`;
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${T}`;
  });
}

beforeAll(async () => {
  db = postgres(process.env.DATABASE_URL as string, { max: 3 });
  await asTenant(async (tx) => {
    await tx`DELETE FROM employee.hrms_employee_scanned_documents WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${T}`;
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${T}, 'FX', 'Fixture Dept', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESG}, ${T}, 'FX', 'Fixture Desg', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
             VALUES (${FIXTURE_IDS.targetId}, ${T}, 'FX-1', 'Fixture Employee', ${DEPT}, ${DESG}, '2012-04-01', ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx`DELETE FROM employee.hrms_employee_scanned_documents WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${T}`;
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${T}`;
  });
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

describe("scan-link fixtures x hrms consumers (hr_employee)", () => {
  it("fixture link request is accepted: linked result parses and matches the fixture shape", async () => {
    await wipe();
    await send(LINK_TOPICS.request("hrms"), fx.request);
    const out = await results(LINK_TOPICS.result("hrms"));
    expect(out).toHaveLength(1);
    const parsed = linkResultSchema.parse(out[0]);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(fx.results.linked).sort());
    expect(parsed).toEqual(fx.results.linked);
    const rows = await asTenant((tx) => tx`SELECT state, doc_type, page_count FROM employee.hrms_employee_scanned_documents WHERE tenant_id = ${T} AND link_id = ${fx.request.linkId}`);
    expect(rows[0]).toMatchObject({ state: "linked", doc_type: "service_book", page_count: 2 });
  });

  it("fixture unlink request is accepted: unlinked result parses and equals the fixture", async () => {
    await send(LINK_TOPICS.unlinkRequest("hrms"), fx.unlinkRequest);
    const out = await results(LINK_TOPICS.unlinkResult("hrms"));
    expect(out).toHaveLength(1);
    const parsed = unlinkResultSchema.parse(out[0]);
    expect(parsed).toEqual(fx.unlinkResults.unlinked);
  });

  it("rejected shapes: unknown employee -> rejected link result; unknown link -> rejected unlink result equal to fixture", async () => {
    await wipe();
    const unknown = linkRequestFixture("hr_employee", { targetId: randomUUID() });
    await send(LINK_TOPICS.request("hrms"), unknown);
    const lr = linkResultSchema.parse((await results(LINK_TOPICS.result("hrms")))[0]);
    // exact equality with the fixture rejected result (reason TARGET_NOT_FOUND); only the unknown targetId differs
    expect(lr).toEqual({ ...fx.results.rejected, targetId: unknown.targetId });
    expect(lr.reason).toBe("TARGET_NOT_FOUND");
    await send(LINK_TOPICS.unlinkRequest("hrms"), unlinkRequestFixture("hr_employee"));
    const ur = unlinkResultSchema.parse((await results(LINK_TOPICS.unlinkResult("hrms")))[0]);
    expect(ur).toEqual(fx.unlinkResults.rejected);
  });
});
