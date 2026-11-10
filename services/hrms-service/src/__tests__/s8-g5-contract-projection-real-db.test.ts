/**
 * S8 G5 -- contract end + project on the employee record, lapse policy, alert routing. Real Postgres, no mocks,
 * run as the NOBYPASSRLS service role with row-level security forced; every seed is written under the tenant
 * context. Three tenants:
 *   OFF   no contract_config row at all (an existing tenant): nothing may change for it.
 *   ON    projection on, project/line manager routing, weekly digest.
 *   FLAG  lapse_action = flag_only with 3 grace days.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc, runWithTenant } from "@civitasone/db";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { COMMANDS, CONSUMED_EVENTS } from "../topics.js";
import { registerContractConsumers } from "../modules/contracts/consumer.js";
import { registerF3_contracts_Consumers } from "../modules/contracts/f3-consumer.js";
import { registerContractExpiryConsumers, sendWeeklyDigest } from "../modules/contracts/expiry-consumer.js";

registerContractConsumers(queue);
registerF3_contracts_Consumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const OFF = "facade00-5d5d-4000-8000-000000005a01";
const ON = "facade00-5d5d-4000-8000-000000005a02";
const FLAG = "facade00-5d5d-4000-8000-000000005a03";
const SEED = "facade00-5d5d-4000-8000-0000000051ff";
const uid = (n: number): string => `facade00-5d5d-4000-8000-00000000${String(n).padStart(4, "0")}`;
const PROJECT_A = "9d3c5a1e-7a2b-4c8e-9f10-2b6d8e4a1c01"; // National e-Governance Gateway
const PROJECT_B = "9d3c5a1e-7a2b-4c8e-9f10-2b6d8e4a1c02"; // Digital Skilling Portal

const hdr = (tenant: string, roles: string[], sub: string) => ({ authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "sess-s8g5" }, SECRET)}` });
const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();
const day = (n: number): string => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let app: Awaited<ReturnType<typeof buildApp>>;

// people: ids are globally unique primary keys, so each tenant gets its own block of ids
const SUB_HR = uid(40), SUB_PM = uid(41);
const people = (base: number) => ({ dept: uid(base + 1), desig: uid(base + 2), hr: uid(base + 10), pm: uid(base + 11), lm: uid(base + 12), e1: uid(base + 21), e2: uid(base + 22), e3: uid(base + 23), e4: uid(base + 24) });
const O = people(1000), N = people(2000), F = people(3000);
const P = (t: string) => (t === OFF ? O : t === ON ? N : F);

async function seedPeople(t: string, opts: { withTeam: boolean }): Promise<void> {
  const p = P(t);
  await asTenant(t, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${p.dept}, ${t}, 'PMU', 'Programme Management Unit', ${SEED}, ${SEED})`);
  await asTenant(t, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${p.desig}, ${t}, 'PA', 'Project Associate', 5, ${SEED}, ${SEED})`);
  const people: Array<[string, string, string, string | null, string | null, string | null]> = [
    [p.hr, "S8-HR", "Kavita Menon", SUB_HR, null, null],
    [p.pm, "S8-PM", "Rajesh Iyer", SUB_PM, null, null],
    [p.lm, "S8-LM", "Sunita Bhargava", null, null, null],
  ];
  if (opts.withTeam) {
    people.push([p.e1, "S8-001", "Anil Kumar Verma", null, p.lm, p.pm], [p.e2, "S8-002", "Meera Pillai", null, p.lm, p.pm],
      [p.e3, "S8-003", "Imran Sheikh", null, p.lm, null], [p.e4, "S8-004", "Deepa Nair", null, null, null]);
  }
  for (const [id, no, name, sub, mgr, pm] of people) {
    await asTenant(t, (tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, manager_id, project_manager_id, created_by, updated_by)
      VALUES (${id}, ${t}, ${no}, ${name}, ${p.dept}, ${p.desig}, '2025-04-01', 'contract', ${sub}, ${mgr}, ${pm}, ${SEED}, ${SEED})`);
  }
}

async function seedContract(t: string, id: string, emp: string, status: string, start: string, end: string, terms: Record<string, unknown>, prev: string | null = null, renewals = 0): Promise<void> {
  await asTenant(t, (tx) => tx`INSERT INTO contracts.hrms_contracts (id, tenant_id, employee_id, contract_no, start_date, end_date, status, terms, previous_contract_id, renewal_count, created_by, updated_by)
    VALUES (${id}, ${t}, ${emp}, ${"CON-S8-" + id.slice(-4)}, ${start}, ${end}, ${status}, ${JSON.stringify(terms)}::jsonb, ${prev}, ${renewals}, ${SEED}, ${SEED})`);
}
const termsA = { role: "Project Analyst", compensationMinor: "6500000", currency: "INR", projectId: PROJECT_A, projectCode: "NIC-EGOV-014", projectName: "National e-Governance Gateway" };
const termsB = { role: "Content Developer", compensationMinor: "5200000", currency: "INR", projectId: PROJECT_B, projectCode: "DIC-SKILL-007", projectName: "Digital Skilling Portal" };

async function setConfig(t: string, cols: Record<string, unknown>): Promise<void> {
  await asTenant(t, (tx) => tx`INSERT INTO contracts.hrms_contract_config (id, tenant_id, lapse_action, grace_days, notify_roles, employee_projection_enabled, weekly_digest_enabled)
    VALUES (${randomUUID()}, ${t}, ${String(cols.lapse_action ?? "auto_separate")}, ${Number(cols.grace_days ?? 0)}, ${JSON.stringify(cols.notify_roles ?? [])}::jsonb, ${Boolean(cols.employee_projection_enabled ?? false)}, ${Boolean(cols.weekly_digest_enabled ?? false)})`);
}

type Proj = { contract_id: string | null; contract_start_date: string | null; contract_end_date: string | null; contract_status: string | null; contract_renewal_count: number | null; primary_project_id: string | null; project_code: string | null; project_name: string | null };
async function proj(t: string, emp: string): Promise<Proj> {
  const r = await asTenant(t, (tx) => tx`SELECT contract_id, contract_start_date::text, contract_end_date::text, contract_status, contract_renewal_count, primary_project_id, project_code, project_name FROM employee.hrms_employees WHERE tenant_id = ${t} AND id = ${emp}`);
  return r[0] as unknown as Proj;
}
async function contractStatus(t: string, id: string): Promise<string> {
  return (await asTenant(t, (tx) => tx`SELECT status FROM contracts.hrms_contracts WHERE id = ${id}`))[0]!.status as string;
}
async function outbox(t: string, topic: string): Promise<Array<{ payload: Record<string, any> }>> {
  return (await asTenant(t, (tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${t} AND topic = ${topic} ORDER BY created_at`)) as unknown as Array<{ payload: Record<string, any> }>;
}
async function notices(t: string, template: string): Promise<Array<Record<string, any>>> {
  return (await outbox(t, "notification.send")).map((m) => m.payload).filter((p) => p.template === template);
}
async function publish(t: string, topic: string, actor: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(topic, { messageId: randomUUID(), type: topic, tenantId: t, actorId: actor, correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: t, ...payload } });
  await drain();
}
async function runDetector(t: string): Promise<void> {
  const q = new MemoryQueue();
  const raw = q.subscribe.bind(q);
  (q as unknown as { subscribe: Queue["subscribe"] }).subscribe = ((topic: string, h: (m: any) => Promise<void>) =>
    raw(topic, async (m: any) => { await runWithTenant(m.tenantId, () => h(m)); })) as Queue["subscribe"];
  registerContractExpiryConsumers(q);
  await q.start();
  await q.publish(COMMANDS.contractExpiryDetect, {
    messageId: randomUUID(), type: COMMANDS.contractExpiryDetect, tenantId: t, actorId: SEED,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: t },
  });
  await q.drain();
}

async function cleanup(): Promise<void> {
  for (const t of [OFF, ON, FLAG]) {
    for (const tbl of ["contracts.hrms_contract_notifications", "contracts.hrms_contract_renewals", "contracts.hrms_contracts", "contracts.hrms_contract_config", "contracts.hrms_contract_seq",
      "_outbox.messages", "_inbox.processed", "employee.hrms_employees", "employee.hrms_designations", "employee.hrms_departments"]) {
      if (tbl === "_inbox.processed") continue; // no tenant column
      await asTenant(t, (tx) => tx.unsafe(`DELETE FROM ${tbl} WHERE tenant_id = '${t}'`));
    }
  }
}

const K_OFF = uid(60), K_ON1 = uid(61), K_ON2 = uid(62), K_ON3 = uid(64), K_ON4 = uid(65);
const K_FL1 = uid(70), K_FL2 = uid(71), K_FL3 = uid(72), K_OFF_LAPSED = uid(73);

beforeAll(async () => {
  await cleanup();
  await seedPeople(OFF, { withTeam: true });
  await seedPeople(ON, { withTeam: true });
  await seedPeople(FLAG, { withTeam: true });
  await setConfig(ON, { employee_projection_enabled: true, notify_roles: ["project_manager", "line_manager"], weekly_digest_enabled: true });
  await setConfig(FLAG, { lapse_action: "flag_only", grace_days: 3 });
  // OFF: draft contract on O.e1 (will be activated), plus a lapsed one on O.e2
  await seedContract(OFF, K_OFF, O.e1, "draft", "2026-04-01", day(120), termsA);
  await seedContract(OFF, K_OFF_LAPSED, O.e2, "active", "2025-04-01", day(-1), termsA);
  // ON
  await seedContract(ON, K_ON1, N.e1, "draft", "2026-04-01", day(200), termsA);
  await seedContract(ON, K_ON2, N.e2, "active", "2026-04-01", day(7), termsB); // inside the 7-day milestone
  await seedContract(ON, K_ON3, N.e3, "draft", "2026-04-01", day(300), termsB);
  // FLAG
  await seedContract(FLAG, K_FL1, F.e1, "active", "2025-04-01", day(-1), termsA);   // lapsed yesterday, inside grace
  await seedContract(FLAG, K_FL2, F.e2, "active", "2025-04-01", day(-5), termsB);   // lapsed 5 days ago, past grace
  await seedContract(FLAG, K_FL3, F.e3, "active", "2025-04-01", day(-2), termsA);   // lapsed, but a renewal is pending
  await asTenant(FLAG, (tx) => tx`INSERT INTO contracts.hrms_contract_renewals (id, tenant_id, contract_id, renewal_number, initiated_by, status, new_end_date, original_terms, new_terms, created_by, updated_by)
    VALUES (${randomUUID()}, ${FLAG}, ${K_FL3}, 1, ${SEED}, 'pending_approval', ${day(365)}, '{}'::jsonb, '{}'::jsonb, ${SEED}, ${SEED})`);
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const getEmp = (t: string, id: string) => app.inject({ method: "GET", url: `/v1/hrms/employees/${id}`, headers: hdr(t, ["hr_admin"], SUB_HR) });

describe("flag OFF (a tenant with no contract config): nothing about the employee record changes", () => {
  it("activating a contract leaves every projection column NULL and the detail payload without contract keys", async () => {
    await publish(OFF, COMMANDS.contractActivate, SEED, { contractId: K_OFF });
    expect(await contractStatus(OFF, K_OFF)).toBe("active");
    expect(Object.values(await proj(OFF, O.e1)).every((v) => v === null)).toBe(true);
    const r = await getEmp(OFF, O.e1);
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    for (const k of ["contractId", "contractEndDate", "contractStatus", "projectCode", "projectName", "primaryProjectId", "projectManagerId"]) expect(body).not.toHaveProperty(k);
  });

  it("the list payload has no contract columns and the new filters simply match nothing", async () => {
    const l = await app.inject({ method: "GET", url: "/v1/hrms/employees?limit=50", headers: hdr(OFF, ["hr_admin"], SUB_HR) });
    expect(l.statusCode).toBe(200);
    for (const row of (l.json() as { data: Array<Record<string, unknown>> }).data) {
      for (const k of ["contractEndDate", "contractStatus", "projectCode", "projectName"]) expect(row).not.toHaveProperty(k);
    }
    const f = await app.inject({ method: "GET", url: `/v1/hrms/employees?projectId=${PROJECT_A}`, headers: hdr(OFF, ["hr_admin"], SUB_HR) });
    expect((f.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it("the default lapse behaviour is untouched: an unrenewed lapse expires the contract and publishes the auto-separate command", async () => {
    await runDetector(OFF);
    expect(await contractStatus(OFF, K_OFF_LAPSED)).toBe("expired");
    expect((await outbox(OFF, COMMANDS.contractAutoSeparate)).some((m) => m.payload.contractId === K_OFF_LAPSED)).toBe(true);
    expect(await notices(OFF, "contract_lapsed_flagged")).toHaveLength(0);
  });

  it("milestone alerts keep the old routing: the employee only, no project data (no notify_roles configured)", async () => {
    await seedContract(OFF, uid(80), O.e4, "active", "2026-04-01", day(7), termsA);
    await runDetector(OFF);
    const n = (await notices(OFF, "contract_expiry_reminder")).find((p) => p.data.contractId === uid(80))!;
    expect(n.recipients).toEqual([O.e4]);
    expect(n.roles).toEqual(["hr_admin", "manager"]);
    expect(n.data).not.toHaveProperty("projectCode");
  });
});

describe("flag ON: the employee record carries the contract and project", () => {
  it("activate projects start, end, status, renewal count and the project onto the employee", async () => {
    await publish(ON, COMMANDS.contractActivate, SEED, { contractId: K_ON1 });
    expect(await proj(ON, N.e1)).toEqual({
      contract_id: K_ON1, contract_start_date: "2026-04-01", contract_end_date: day(200), contract_status: "active",
      contract_renewal_count: 0, primary_project_id: PROJECT_A, project_code: "NIC-EGOV-014", project_name: "National e-Governance Gateway",
    });
  });

  it("the detail and list payloads expose the snapshot, and the filters narrow by project, status and end date", async () => {
    await publish(ON, COMMANDS.contractActivate, SEED, { contractId: K_ON3 });
    const d = (await getEmp(ON, N.e1)).json() as Record<string, unknown>;
    expect(d).toMatchObject({ contractId: K_ON1, contractStatus: "active", contractEndDate: day(200), contractStartDate: "2026-04-01", contractRenewalCount: 0, projectCode: "NIC-EGOV-014", primaryProjectId: PROJECT_A, projectManagerId: N.pm });
    const h = hdr(ON, ["hr_admin"], SUB_HR);
    const ids = async (qs: string) => ((await app.inject({ method: "GET", url: `/v1/hrms/employees?limit=50&${qs}`, headers: h })).json() as { data: Array<{ id: string; projectCode?: string; contractEndDate?: string }> }).data;
    const byProject = await ids(`projectId=${PROJECT_A}`);
    expect(byProject.map((r) => r.id)).toEqual([N.e1]);
    expect(byProject[0]).toMatchObject({ projectCode: "NIC-EGOV-014", contractEndDate: day(200) });
    expect((await ids(`projectId=${PROJECT_B}`)).map((r) => r.id)).toEqual([N.e3]);
    expect((await ids(`contractEndBefore=${day(250)}`)).map((r) => r.id)).toEqual([N.e1]);
    expect((await ids(`contractEndBefore=${day(400)}`)).map((r) => r.id).sort()).toEqual([N.e1, N.e3].sort());
    expect((await ids("contractStatus=active")).map((r) => r.id).sort()).toEqual([N.e1, N.e3].sort());
    expect(await ids("contractStatus=expired")).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/v1/hrms/employees?projectId=nope", headers: h })).statusCode).toBe(400);
  });

  it("isolation: the other tenant never sees this tenant's project through the same filter", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees?projectId=${PROJECT_A}`, headers: hdr(FLAG, ["hr_admin"], SUB_HR) });
    expect((r.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it("renewal: approving keeps the old contract on the record until the renewal is activated, then shows contract 2 with renewal count 1", async () => {
    const renewalId = randomUUID();
    await asTenant(ON, (tx) => tx`INSERT INTO contracts.hrms_contract_renewals (id, tenant_id, contract_id, renewal_number, initiated_by, status, new_end_date, original_terms, new_terms, created_by, updated_by)
      VALUES (${renewalId}, ${ON}, ${K_ON1}, 1, ${SEED}, 'pending_approval', ${day(565)}, ${JSON.stringify(termsA)}::jsonb, ${JSON.stringify(termsA)}::jsonb, ${SEED}, ${SEED})`);
    await publish(ON, CONSUMED_EVENTS.contractRenewalDecided, SEED, { renewalId, decision: "approved", decidedBy: SEED });
    expect((await proj(ON, N.e1)).contract_status).toBe("renewed");
    expect((await proj(ON, N.e1)).contract_id).toBe(K_ON1); // the draft successor does not represent the employee yet
    const next = (await asTenant(ON, (tx) => tx`SELECT id FROM contracts.hrms_contracts WHERE tenant_id = ${ON} AND previous_contract_id = ${K_ON1}`))[0]!.id as string;
    await publish(ON, COMMANDS.contractActivate, SEED, { contractId: next });
    const p = await proj(ON, N.e1);
    expect(p.contract_id).toBe(next);
    expect(p).toMatchObject({ contract_status: "active", contract_renewal_count: 1, contract_end_date: day(565), project_code: "NIC-EGOV-014" });
  });

  it("terminate is reflected too", async () => {
    await publish(ON, COMMANDS.contractTerminate, SEED, { contractId: K_ON3, version: 1, reason: "project closed" });
    expect((await proj(ON, N.e3)).contract_status).toBe("terminated");
  });

  it("expiry detection updates the projection through expiring and expired", async () => {
    // K_ON2 was seeded 'active' straight into the table (no projection yet), 7 days from its end with no renewal:
    // the detector moves it active -> expiring -> escalated, and each step refreshes the employee row.
    await runDetector(ON);
    expect(await contractStatus(ON, K_ON2)).toBe("escalated");
    expect(await proj(ON, N.e2)).toMatchObject({ contract_id: K_ON2, contract_status: "escalated", project_code: "DIC-SKILL-007", primary_project_id: PROJECT_B });
  });
});

describe("read-model consistency: drift is detected and repaired, and the repair is idempotent", () => {
  it("check reports the drift, reconcile repairs it, a second reconcile changes nothing", async () => {
    const h = hdr(ON, ["hr_admin"], SUB_HR);
    await asTenant(ON, (tx) => tx`UPDATE employee.hrms_employees SET contract_end_date = '2031-01-01', project_code = 'WRONG' WHERE tenant_id = ${ON} AND id = ${N.e1}`);
    const before = (await app.inject({ method: "GET", url: "/v1/hrms/contracts/projection/check", headers: h })).json() as { data: { drifted: number; consistent: boolean } };
    expect(before.data.drifted).toBeGreaterThanOrEqual(1);
    expect(before.data.consistent).toBe(false);
    const post = await app.inject({ method: "POST", url: "/v1/hrms/contracts/projection/reconcile", headers: h });
    expect(post.statusCode).toBe(202);
    await drain();
    expect((await proj(ON, N.e1)).project_code).toBe("NIC-EGOV-014");
    const after = (await app.inject({ method: "GET", url: "/v1/hrms/contracts/projection/check", headers: h })).json() as { data: { drifted: number; consistent: boolean } };
    expect(after.data).toMatchObject({ drifted: 0, consistent: true });
    await app.inject({ method: "POST", url: "/v1/hrms/contracts/projection/reconcile", headers: h });
    await drain();
    expect(((await app.inject({ method: "GET", url: "/v1/hrms/contracts/projection/check", headers: h })).json() as { data: { drifted: number } }).data.drifted).toBe(0);
  });

  it("is HR-only, and does nothing for a tenant that has not opted in", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/hrms/contracts/projection/check", headers: hdr(ON, ["manager"], SUB_PM) })).statusCode).toBe(403);
    await publish(OFF, COMMANDS.contractProjectionReconcile, SEED, {});
    expect(Object.values(await proj(OFF, O.e1)).every((v) => v === null)).toBe(true);
  });
});

describe("lapse policy: auto_separate (default) versus flag_only with grace days", () => {
  it("flag_only never expires the contract or publishes a separation, and flags HR once (idempotent across runs)", async () => {
    await runDetector(FLAG);
    expect(await contractStatus(FLAG, K_FL1)).not.toBe("expired");
    expect(await outbox(FLAG, COMMANDS.contractAutoSeparate)).toHaveLength(0);
    expect(await outbox(FLAG, "hrms.contract.expired")).toHaveLength(0);
    const flagged = (await notices(FLAG, "contract_lapsed_flagged")).filter((p) => p.data.contractId === K_FL1);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.roles).toEqual(["hr_admin"]);
    await runDetector(FLAG);
    expect((await notices(FLAG, "contract_lapsed_flagged")).filter((p) => p.data.contractId === K_FL1)).toHaveLength(1);
    // inside grace: no escalation yet
    expect((await notices(FLAG, "contract_lapse_grace_elapsed")).filter((p) => p.data.contractId === K_FL1)).toHaveLength(0);
  });

  it("past the grace period the same contract is escalated to the department head too, once, and still not separated", async () => {
    const esc = (await notices(FLAG, "contract_lapse_grace_elapsed")).filter((p) => p.data.contractId === K_FL2);
    expect(esc).toHaveLength(1);
    expect(esc[0]!.roles).toEqual(["hr_admin", "department_head"]);
    expect(esc[0]!.data).toMatchObject({ daysPastEnd: 5, graceDays: 3 });
    expect(await contractStatus(FLAG, K_FL2)).not.toBe("expired");
  });

  it("a pending renewal suppresses the flag", async () => {
    expect((await notices(FLAG, "contract_lapsed_flagged")).filter((p) => p.data.contractId === K_FL3)).toHaveLength(0);
  });

  it("a manually published auto-separate command is also refused for a flag_only tenant (no lifecycle separation)", async () => {
    await publish(FLAG, COMMANDS.contractAutoSeparate, SEED, { contractId: K_FL1 });
    expect(await outbox(FLAG, COMMANDS.lifecycleSeparate)).toHaveLength(0);
    expect(await contractStatus(FLAG, K_FL1)).not.toBe("expired");
  });

  it("the audit trail records the flag", async () => {
    const a = (await outbox(FLAG, "audit.event.record")).map((m) => m.payload.action);
    expect(a).toContain("lapse_flagged");
    expect(a).toContain("lapse_grace_elapsed");
    expect(a).toContain("auto_separate_skipped");
  });
});

describe("tenant policy setting via the config route", () => {
  const patch = (payload: Record<string, unknown>, roles = ["hr_admin"]) =>
    app.inject({ method: "PATCH", url: "/v1/hrms/contracts/config", headers: hdr(OFF, roles, SUB_HR), payload });
  it("rejects values outside the two options, a negative or oversized grace, and non-HR callers", async () => {
    expect((await patch({ lapseAction: "terminate_immediately" })).statusCode).toBe(400);
    expect((await patch({ graceDays: -1 })).statusCode).toBe(400);
    expect((await patch({ graceDays: 366 })).statusCode).toBe(400);
    expect((await patch({ notifyRoles: ["ceo"] })).statusCode).toBe(400);
    expect((await patch({ lapseAction: "flag_only" }, ["employee"])).statusCode).toBe(403);
  });
  it("stores flag_only with grace days, audits who changed it, and leaves the column defaults for what it did not set", async () => {
    const r = await patch({ lapseAction: "flag_only", graceDays: 10 });
    expect(r.statusCode).toBe(200);
    await drain();
    const row = (await asTenant(OFF, (tx) => tx`SELECT lapse_action, grace_days, notify_roles, employee_projection_enabled, weekly_digest_enabled, auto_separation_enabled FROM contracts.hrms_contract_config WHERE tenant_id = ${OFF}`))[0]!;
    expect(row).toMatchObject({ lapse_action: "flag_only", grace_days: 10, employee_projection_enabled: false, weekly_digest_enabled: false, auto_separation_enabled: true });
    expect((await outbox(OFF, "audit.event.record")).some((m) => m.payload.action === "config_update" && m.payload.lapseAction === "flag_only")).toBe(true);
    await asTenant(OFF, (tx) => tx`DELETE FROM contracts.hrms_contract_config WHERE tenant_id = ${OFF}`); // back to "existing tenant"
  });
});

describe("alert routing to the project manager and line manager", () => {
  it("with notify_roles set, the 7-day alert reaches the employee, the project manager and the line manager, and names the project", async () => {
    await runDetector(ON);
    const n = (await notices(ON, "contract_expiry_reminder")).find((p) => p.data.contractId === K_ON2 && p.data.milestone === 7)!;
    expect(new Set(n.recipients)).toEqual(new Set([N.e2, N.pm, N.lm]));
    expect(n.data).toMatchObject({ milestone: 7, projectCode: "DIC-SKILL-007", projectName: "Digital Skilling Portal" });
  });

  it("the weekly digest counts contracts ending within 30 days and those with no renewal request, to HR", async () => {
    await runWithTenant(ON, () => sendWeeklyDigest(ON, day(0)));
    const d = await notices(ON, "contract_expiry_weekly_digest");
    expect(d).toHaveLength(1);
    expect(d[0]!.roles).toEqual(["hr_admin"]);
    expect(d[0]!.data.endingSoon).toBeGreaterThanOrEqual(1);
    expect(d[0]!.data.withoutRenewal).toBeGreaterThanOrEqual(1);
    expect(d[0]!.data.windowDays).toBe(30);  });
});

describe("project manager as renewal initiator (maker); HR stays the approver", () => {
  const pm = (tenant: string) => hdr(tenant, ["manager"], SUB_PM);
  it("on an opted-in tenant the project manager sees their project team's contracts only, and can start a renewal", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/hrms/contracts?limit=50", headers: pm(ON) });
    expect(list.statusCode).toBe(200);
    const emps = new Set((list.json() as { data: Array<{ employeeId: string }> }).data.map((c) => c.employeeId));
    expect(emps.has(N.e1)).toBe(true);
    expect(emps.has(N.e2)).toBe(true);
    expect(emps.has(N.e4)).toBe(false); // not on this PM's team
    const e2c = (await asTenant(ON, (tx) => tx`SELECT id FROM contracts.hrms_contracts WHERE tenant_id = ${ON} AND employee_id = ${N.e1} AND status = 'active'`))[0]!.id as string; // the renewed contract 2
    const renew = await app.inject({ method: "POST", url: `/v1/hrms/contracts/${e2c}/renew`, headers: pm(ON), payload: { newEndDate: day(400), reason: "Project phase 2 sanctioned" } });
    expect(renew.statusCode).toBe(202);
  });

  it("on a tenant that has not opted in the same person has no such access (manager-scope rule unchanged)", async () => {
    const c = (await asTenant(OFF, (tx) => tx`SELECT id FROM contracts.hrms_contracts WHERE tenant_id = ${OFF} AND employee_id = ${O.e1}`))[0]!.id as string;
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contracts/${c}/renew`, headers: pm(OFF), payload: { newEndDate: day(400) } });
    expect(r.statusCode).toBe(403);
  });
});

describe("expiring dashboard: project columns, project filter, CSV (all opt-in)", () => {
  const monthEnd = (): string => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };
  beforeAll(async () => {
    await seedContract(ON, uid(90), N.e4, "active", "2026-04-01", monthEnd(), { ...termsA, role: "=HYPERLINK(\"http://x\")", projectName: "=Gateway Phase II" });
    await seedContract(ON, uid(91), N.hr, "active", "2026-04-01", monthEnd(), termsB);
  });
  const dash = (qs = "") => app.inject({ method: "GET", url: `/v1/hrms/contracts/dashboard/expiring${qs}`, headers: hdr(ON, ["hr_admin"], SUB_HR) });
  it("with no query the response has no project keys (unchanged)", async () => {
    const rows = (await dash()).json() as { data: Array<Record<string, unknown>> };
    expect(rows.data.length).toBeGreaterThanOrEqual(2);
    for (const r of rows.data) expect(r).not.toHaveProperty("projectCode");
  });
  it("expand=project adds project and manager names; projectId narrows the rows", async () => {
    const all = (await dash("?expand=project")).json() as { data: Array<Record<string, any>> };
    const mine = all.data.find((r) => r.id === uid(90))!;
    expect(mine).toMatchObject({ projectCode: "NIC-EGOV-014", employeeName: "Deepa Nair" });
    const only = (await dash(`?projectId=${PROJECT_B}`)).json() as { data: Array<Record<string, any>> };
    expect(only.data.every((r) => r.projectId === PROJECT_B)).toBe(true);
    expect(only.data.map((r) => r.id)).toContain(uid(91));
    expect(only.data.map((r) => r.id)).not.toContain(uid(90));
  });
  it("csv has a header, quotes every cell and neutralises formula-looking text", async () => {
    const r = await dash("?format=csv");
    expect(r.headers["content-type"]).toContain("text/csv");
    const lines = r.body.split("\r\n");
    expect(lines[0]).toContain("\"Project Manager\"");
    expect(r.body).toContain("\"'=Gateway Phase II\"");
    expect(r.body).not.toMatch(/(^|,)"=/m);
  });
});
