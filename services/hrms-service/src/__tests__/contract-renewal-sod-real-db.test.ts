/**
 * Contract renewal segregation of duties -- consumer-level, real DB (no mocks).
 * Owner decision 2026-10-14: nobody renews their own contract. The route-level
 * 403 on POST /:id/renew is a fast path; the guarantee lives in the queue
 * consumers (renewal-initiate and bulk-renewal), so POST /bulk-renew -- which
 * the route never checked -- is covered too, as is a message published
 * straight onto the queue.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { COMMANDS } from "../topics.js";
import { registerContractConsumers } from "../modules/contracts/consumer.js";

registerContractConsumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-5d5d-4000-8000-000000000c01";
const SEED = "facade00-5d5d-4000-8000-0000000001ff";
const id = (n: number): string => `facade00-5d5d-4000-8000-00000000${String(n).padStart(4, "0")}`;
const DEPT = id(0x1d1), DESIG = id(0x1d2);
const HR_EMP = id(0x1e1), OTHER_EMP = id(0x1e2);
const SUB = { hr: id(0x3a1), other: id(0x3a2) }; // real actor ids are uuids (created_by is a uuid column)
const K_HR = id(0x2a1), K_OTHER = id(0x2a2);

const h = (roles: string[], sub: string) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-sod" }, SECRET)}` });
let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();

async function cleanup(): Promise<void> {
  for (const t of ["contracts.hrms_contract_renewals", "contracts.hrms_contracts",
    "employee.hrms_employees", "employee.hrms_designations", "employee.hrms_departments"]) {
    await asTenant((tx) => tx.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`));
  }
}
async function renewalsFor(contractId: string): Promise<number> {
  const rows = await asTenant((tx) => tx`SELECT id FROM contracts.hrms_contract_renewals WHERE tenant_id = ${TENANT} AND contract_id = ${contractId}`);
  return rows.length;
}
async function clearRenewals(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM contracts.hrms_contract_renewals WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'SOD', 'SoD Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'SODD', 'SoD Desig', 5, ${SEED}, ${SEED})`);
  for (const [eid, no, sub] of [[HR_EMP, "SOD-H", SUB.hr], [OTHER_EMP, "SOD-O", SUB.other]] as const) {
    await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
      VALUES (${eid}, ${TENANT}, ${no}, ${"SoD " + no}, ${DEPT}, ${DESIG}, '2026-01-01', ${sub}, ${SEED}, ${SEED})`);
  }
  for (const [kid, emp, no] of [[K_HR, HR_EMP, "H"], [K_OTHER, OTHER_EMP, "O"]] as const) {
    await asTenant((tx) => tx`INSERT INTO contracts.hrms_contracts (id, tenant_id, employee_id, contract_no, start_date, end_date, status, created_by, updated_by)
      VALUES (${kid}, ${TENANT}, ${emp}, ${"SOD-" + no}, '2026-01-01', '2027-01-01', 'active', ${SEED}, ${SEED})`);
  }
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const bulk = (contractIds: string[], sub: string) =>
  app.inject({ method: "POST", url: "/v1/hrms/contracts/bulk-renew", headers: h(["hr_admin"], sub), payload: { contractIds, newEndDate: "2029-01-01" } });

describe("bulk-renew -- segregation of duties lives in the consumer", () => {
  it("an HR user bulk-renewing their OWN contract is refused: the route accepts (202) but no renewal row is created", async () => {
    await clearRenewals();
    const r = await bulk([K_HR], SUB.hr);
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await renewalsFor(K_HR)).toBe(0);
  });

  it("a mixed batch: the actor's own contract is skipped, a colleague's is still processed", async () => {
    await clearRenewals();
    // Published straight onto the queue with newTerms: the HTTP route's bulkRenewalBody never
    // forwards newTerms, so the consumer's insert of a colleague's renewal hits the NOT NULL on
    // new_terms (pre-existing, unrelated to SoD) -- this positive control must not depend on it.
    await queue.publish(COMMANDS.contractRenewalBulk, {
      messageId: randomUUID(), type: COMMANDS.contractRenewalBulk, tenantId: TENANT, actorId: SUB.hr,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: TENANT, contractIds: [K_HR, K_OTHER], newEndDate: "2029-01-01", newTerms: {}, initiatedBy: SUB.hr },
    });
    await drain();
    expect(await renewalsFor(K_HR)).toBe(0);
    expect(await renewalsFor(K_OTHER)).toBe(1);
  });

  it("the refusal rolls back with markProcessed: the per-contract dedup key is not consumed", async () => {
    await clearRenewals();
    const messageId = randomUUID();
    await queue.publish(COMMANDS.contractRenewalBulk, {
      messageId, type: COMMANDS.contractRenewalBulk, tenantId: TENANT, actorId: SUB.hr,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: TENANT, contractIds: [K_HR], newEndDate: "2029-01-01" },
    });
    await drain();
    expect(await renewalsFor(K_HR)).toBe(0);
    const key = (await import("../shared/ids.js")).uuidV5(`${messageId}:${K_HR}`);
    const rows = await asTenant((tx) => tx`SELECT 1 FROM _inbox.processed WHERE message_id = ${key}`);
    expect(rows.length).toBe(0);
  });
});

describe("renewal-initiate consumer -- segregation of duties without the route", () => {
  const publishInitiate = async (actor: string, contractId: string): Promise<void> => {
    await queue.publish(COMMANDS.contractRenewalInitiate, {
      messageId: randomUUID(), type: COMMANDS.contractRenewalInitiate, tenantId: TENANT, actorId: actor,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT, contractId, newEndDate: "2029-01-01", newTerms: {}, initiatedBy: actor },
    });
    await drain();
  };
  it("a renewal-initiate message from the contract's own employee creates nothing", async () => {
    await clearRenewals();
    await publishInitiate(SUB.hr, K_HR);
    expect(await renewalsFor(K_HR)).toBe(0);
  });
  it("the same message from another actor is processed", async () => {
    await clearRenewals();
    await publishInitiate(SUB.hr, K_OTHER);
    expect(await renewalsFor(K_OTHER)).toBe(1);
  });
});
