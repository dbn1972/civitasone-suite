/**
 * fin-payroll-03 gap batch, end to end against a REAL Postgres (migrated
 * through 0068), through buildApp() and the real consumers (memory queue,
 * FORCE RLS): DDO deactivation, pay-group schedules + (de)activation,
 * pensioner stop / deceased + masked list + audited reveal, salary-revision
 * maker != checker (incl. a race), reimbursement receipts, PT effective date,
 * pay-history read audit.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance (see
 * vitest.config.ts REL-035).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";

const EMPLOYEE_BY_ACTOR = new Map<string, string>();
const UPLOADED = new Map<string, { contentLength: number; contentType: string }>();
const upload = (key: string, over: Partial<{ contentLength: number; contentType: string }> = {}) =>
  UPLOADED.set(key, { contentLength: 2048, contentType: "application/pdf", ...over });

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/hrms-client.js")>()),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
  fetchPayrollReadiness: vi.fn(async () => new Map()),
  verifyEmployeeExists: vi.fn(async () => true),
  resolveActorEmployeeId: vi.fn(async (_tenant: string, actor: string) => EMPLOYEE_BY_ACTOR.get(actor) ?? null),
}));

vi.mock("@civitasone/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@civitasone/storage")>()),
  presignedPutUrl: vi.fn(async ({ key }: { key: string }) => `https://bucket.example/put/${key}?sig=1`),
  presignedGetUrl: vi.fn(async ({ key }: { key: string }) => `https://bucket.example/get/${key}?sig=2`),
  headObject: vi.fn(async (key: string) => UPLOADED.get(key) ?? null),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers, resolveLatestRevision } from "../src/modules/payroll/consumer.js";
import * as commands from "../src/modules/payroll/fin03-commands.js";
import type { RequestContext } from "@civitasone/types";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const CHECKER_2 = randomUUID();
const EMP_USER = randomUUID();
const OTHER_EMP_USER = randomUUID();
const EMP_ID = randomUUID();
const OTHER_EMP_ID = randomUUID();

const OFFICER = ["payroll_officer"];
const ADMIN = ["payroll_admin"];
const HR_ADMIN = ["hr_admin"];

function auth(sub: string, roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "fin03" }, SECRET)}` };
}

let app: Awaited<ReturnType<typeof buildApp>>;
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);

async function q(text: ReturnType<typeof sql>, tenant = TENANT): Promise<Row[]> {
  return withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => rowsOf(await tx.execute(text)));
}

async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    v = await fn();
  }
  return v;
}
const settle = () => new Promise((r) => setTimeout(r, 300));

async function auditsFor(resourceId: string, action?: string): Promise<Row[]> {
  const rows = await q(sql`
    SELECT actor_id, payload FROM _outbox.messages
     WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${resourceId}
     ORDER BY created_at`);
  return action ? rows.filter((r) => (r.payload as Record<string, unknown>).action === action) : rows;
}

async function eventsFor(topic: string, idField: string, id: string): Promise<Row[]> {
  return q(sql`SELECT payload FROM _outbox.messages WHERE topic = ${topic} AND payload->>${idField} = ${id}`);
}

beforeAll(async () => {
  registerPayrollConsumers(queue);
  await (queue as unknown as { start?: () => Promise<void> }).start?.();
  app = await buildApp();
  EMPLOYEE_BY_ACTOR.set(EMP_USER, EMP_ID);
  EMPLOYEE_BY_ACTOR.set(OTHER_EMP_USER, OTHER_EMP_ID);
});

afterAll(async () => {
  await app?.close();
  await sqlClient.end();
});

// ─── DDOs (GAP-PAYROLL-DDOS-03) ─────────────────────────────────────────────
describe("DDO deactivation", () => {
  const CODE = `DDO-${randomUUID().slice(0, 6)}`;
  let structureId: string;

  it("creates a DDO, lists it as active, refuses deactivation while a pensioner is active, then deactivates once it is clear", async () => {
    structureId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, created_by, updated_by)
        VALUES (${structureId}::uuid, ${TENANT}::uuid, ${"Struct " + structureId.slice(0, 4)}, ${MAKER}::uuid, ${MAKER}::uuid)`);
    }));
    expect((await app.inject({ method: "POST", url: "/v1/payroll/ddos", headers: auth(MAKER, OFFICER), payload: { ddoCode: CODE, name: "Treasury" } })).statusCode).toBe(202);
    await until(() => q(sql`SELECT 1 FROM payroll.payroll_ddos WHERE ddo_code = ${CODE}`), (r) => r.length > 0);

    const list = await app.inject({ method: "GET", url: "/v1/payroll/ddos", headers: auth(MAKER, OFFICER) });
    expect((list.json() as Array<{ ddoCode: string; isActive: boolean }>).find((d) => d.ddoCode === CODE)?.isActive).toBe(true);

    const pensionerRes = await app.inject({
      method: "POST", url: "/v1/payroll/pensioners", headers: auth(MAKER, OFFICER),
      payload: { ppoNo: `PPO/${CODE}`, fullName: "Ramesh Sharma", dateOfBirth: "1958-01-01", basicPensionMinor: 2500000, taxRegime: "new", ddoCode: CODE },
    });
    const pensionerId = (pensionerRes.json() as { id: string }).id;
    await until(() => q(sql`SELECT 1 FROM payroll.payroll_pensioners WHERE id = ${pensionerId}::uuid`), (r) => r.length > 0);

    const blocked = await app.inject({
      method: "PATCH", url: `/v1/payroll/ddos/${CODE}/status`, headers: auth(MAKER, OFFICER),
      payload: { active: false, reason: "Office merged into another DDO" },
    });
    expect(blocked.statusCode).toBe(409);
    expect((blocked.json() as { code: string }).code).toBe("DDO_IN_USE");

    // Stop the pension -> nothing active references the DDO any more.
    expect((await app.inject({
      method: "PATCH", url: `/v1/payroll/pensioners/${pensionerId}/status`, headers: auth(MAKER, OFFICER),
      payload: { status: "stopped", reason: "Life certificate not filed" },
    })).statusCode).toBe(202);
    await until(() => q(sql`SELECT status FROM payroll.payroll_pensioners WHERE id = ${pensionerId}::uuid`), (r) => r[0]?.status === "stopped");

    const ok = await app.inject({
      method: "PATCH", url: `/v1/payroll/ddos/${CODE}/status`, headers: auth(MAKER, OFFICER),
      payload: { active: false, reason: "Office merged into another DDO" },
    });
    expect(ok.statusCode).toBe(202);
    const row = await until(() => q(sql`SELECT is_active, deactivated_by::text AS by FROM payroll.payroll_ddos WHERE ddo_code = ${CODE}`), (r) => r[0]?.is_active === false);
    expect(row[0]).toMatchObject({ is_active: false, by: MAKER });
    const audit = await until(() => auditsFor(CODE, "deactivate"), (a) => a.length > 0);
    expect((audit[0]!.payload as Record<string, unknown>).reason).toBe("Office merged into another DDO");

    const after = await app.inject({ method: "GET", url: "/v1/payroll/ddos", headers: auth(MAKER, OFFICER) });
    expect((after.json() as Array<{ ddoCode: string; isActive: boolean }>).find((d) => d.ddoCode === CODE)?.isActive).toBe(false);
  });

  it("a deactivated DDO cannot start a payroll run (409 DDO_INACTIVE)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/payroll/runs", headers: auth(MAKER, OFFICER),
      payload: { runNo: `RUN-${randomUUID().slice(0, 6)}`, month: "2026-09", structureId, ddoCode: CODE },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe("DDO_INACTIVE");
  });

  it("the consumer re-checks usage atomically: a deactivate command that races a new active pensioner changes nothing", async () => {
    const code = `DDO-${randomUUID().slice(0, 6)}`;
    await app.inject({ method: "POST", url: "/v1/payroll/ddos", headers: auth(MAKER, OFFICER), payload: { ddoCode: code, name: "Race" } });
    await until(() => q(sql`SELECT 1 FROM payroll.payroll_ddos WHERE ddo_code = ${code}`), (r) => r.length > 0);
    const pid = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_pensioners (id, tenant_id, ppo_no, full_name, date_of_birth, basic_pension_minor, ddo_code, status, created_by, updated_by)
        VALUES (${pid}::uuid, ${TENANT}::uuid, ${"PPO/" + pid}, 'Race', '1960-01-01', 100, ${code}, 'active', ${MAKER}::uuid, ${MAKER}::uuid)`);
    }));
    // Publish straight to the queue, skipping the route's pre-check (as a late-arriving pensioner would).
    const ctx: RequestContext = { tenantId: TENANT, actorId: MAKER, actorType: "user", roles: OFFICER, correlationId: randomUUID() };
    await commands.setDdoActive(ctx, code, false, "Racing deactivation attempt");
    await settle();
    const row = await q(sql`SELECT is_active FROM payroll.payroll_ddos WHERE ddo_code = ${code}`);
    expect(row[0]?.is_active).toBe(true);
    expect(await auditsFor(code, "deactivate")).toHaveLength(0);
  });

  it("is role-gated and tenant-scoped", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/ddos/${CODE}/status`, headers: auth(MAKER, HR_ADMIN), payload: { active: true, reason: "Reactivating for FY27" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/ddos/${CODE}/status`, headers: auth(MAKER, OFFICER, OTHER_TENANT), payload: { active: true, reason: "Reactivating for FY27" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/ddos/${CODE}/status`, headers: auth(MAKER, OFFICER), payload: { active: true, reason: "short" } })).statusCode).toBe(400);
    // reactivate
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/ddos/${CODE}/status`, headers: auth(MAKER, OFFICER), payload: { active: true, reason: "Reactivating for FY27" } })).statusCode).toBe(202);
    await until(() => q(sql`SELECT is_active FROM payroll.payroll_ddos WHERE ddo_code = ${CODE}`), (r) => r[0]?.is_active === true);
  });
});

// ─── Pay groups (GAP-PAYROLL-PAY-GROUPS-01/03) ──────────────────────────────
describe("pay groups: schedules, edit, deactivate", () => {
  const NAME = `Wage ${randomUUID().slice(0, 6)}`;
  let id = "";

  it("creates a weekly group with a weekday and rejects inconsistent schedules", async () => {
    const bad = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(MAKER, OFFICER), payload: { name: "bad", frequency: "monthly", payWeekday: 5 } });
    expect(bad.statusCode).toBe(400);
    const badBi = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(MAKER, OFFICER), payload: { name: "bad2", frequency: "bi_weekly", payWeekParity: 1 } });
    expect(badBi.statusCode).toBe(400);
    const badLast = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(MAKER, OFFICER), payload: { name: "bad3", frequency: "weekly", payWeekday: 5, payLastDay: true } });
    expect(badLast.statusCode).toBe(400);

    const res = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(MAKER, OFFICER), payload: { name: NAME, frequency: "weekly", payWeekday: 5 } });
    expect(res.statusCode).toBe(202);
    id = (res.json() as { id: string }).id;
    const row = await until(() => q(sql`SELECT frequency, pay_weekday, pay_last_day, pay_week_parity FROM payroll.pay_groups WHERE id = ${id}::uuid`), (r) => r.length > 0);
    expect(row[0]).toMatchObject({ frequency: "weekly", pay_weekday: 5, pay_last_day: false, pay_week_parity: null });
  });

  it("the pay calendar lists every Friday for a weekly group (not one clamped day-of-month)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payroll/calendar?fy=2026-27", headers: auth(MAKER, OFFICER) });
    const mine = (res.json() as { calendar: Array<{ group: string; month: string; payDate: string }> }).calendar.filter((c) => c.group === NAME);
    const july = mine.filter((c) => c.month === "2026-07").map((c) => c.payDate);
    expect(july).toEqual(["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]);
  });

  it("edits the group (PATCH merges + validates) and switching to monthly clears the weekday", async () => {
    const bad = await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}`, headers: auth(MAKER, OFFICER), payload: { payWeekParity: 1 } });
    expect(bad.statusCode).toBe(400); // parity on a weekly group

    const ok = await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}`, headers: auth(MAKER, OFFICER), payload: { payWeekday: 4 } });
    expect(ok.statusCode).toBe(202);
    await until(() => q(sql`SELECT pay_weekday FROM payroll.pay_groups WHERE id = ${id}::uuid`), (r) => r[0]?.pay_weekday === 4);

    const monthly = await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}`, headers: auth(MAKER, OFFICER), payload: { frequency: "monthly", payLastDay: true } });
    expect(monthly.statusCode).toBe(202);
    const row = await until(() => q(sql`SELECT frequency, pay_weekday, pay_last_day FROM payroll.pay_groups WHERE id = ${id}::uuid`), (r) => r[0]?.frequency === "monthly");
    expect(row[0]).toMatchObject({ frequency: "monthly", pay_weekday: null, pay_last_day: true });
    expect((await auditsFor(id, "update")).length).toBeGreaterThanOrEqual(2);
  });

  it("a duplicate name is a 409, a missing group a 404, a read-only role a 403", async () => {
    await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(MAKER, OFFICER), payload: { name: NAME + " B", frequency: "monthly" } });
    await until(() => q(sql`SELECT 1 FROM payroll.pay_groups WHERE name = ${NAME + " B"}`), (r) => r.length > 0);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}`, headers: auth(MAKER, OFFICER), payload: { name: NAME + " B" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${randomUUID()}`, headers: auth(MAKER, OFFICER), payload: { name: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}`, headers: auth(MAKER, HR_ADMIN), payload: { name: "x" } })).statusCode).toBe(403);
  });

  it("deactivates (listed only with includeInactive, off the calendar) and reactivates, each audited with its reason", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}/status`, headers: auth(MAKER, OFFICER), payload: { active: false, reason: "Group wound up in FY26" } })).statusCode).toBe(202);
    await until(() => q(sql`SELECT status FROM payroll.pay_groups WHERE id = ${id}::uuid`), (r) => r[0]?.status === "archived");

    const def = await app.inject({ method: "GET", url: "/v1/payroll/pay-groups", headers: auth(MAKER, OFFICER) });
    expect((def.json() as { data: Array<{ id: string }> }).data.some((g) => g.id === id)).toBe(false);
    const all = await app.inject({ method: "GET", url: "/v1/payroll/pay-groups?includeInactive=true", headers: auth(MAKER, OFFICER) });
    expect((all.json() as { data: Array<{ id: string; status: string }> }).data.find((g) => g.id === id)?.status).toBe("archived");
    const cal = await app.inject({ method: "GET", url: "/v1/payroll/calendar?fy=2026-27", headers: auth(MAKER, OFFICER) });
    expect((cal.json() as { calendar: Array<{ group: string }> }).calendar.some((c) => c.group === NAME)).toBe(false);

    // an archived group cannot be edited, and deactivating twice is a 409
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}`, headers: auth(MAKER, OFFICER), payload: { name: NAME + " C" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}/status`, headers: auth(MAKER, OFFICER), payload: { active: false, reason: "Group wound up in FY26" } })).statusCode).toBe(409);

    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pay-groups/${id}/status`, headers: auth(MAKER, OFFICER), payload: { active: true, reason: "Reopened for FY27 wages" } })).statusCode).toBe(202);
    await until(() => q(sql`SELECT status FROM payroll.pay_groups WHERE id = ${id}::uuid`), (r) => r[0]?.status === "active");
    const audits = await until(() => auditsFor(id), (a) => a.some((x) => (x.payload as Record<string, unknown>).action === "activate"));
    expect(audits.map((a) => (a.payload as Record<string, unknown>).action)).toEqual(expect.arrayContaining(["deactivate", "activate"]));
  });
});

// ─── Pensioners (GAP-PAYROLL-PENSIONERS-03/04) ──────────────────────────────
describe("pensioners: masked register, audited reveal, stop / deceased", () => {
  const PPO = `PPO/2024/${Math.floor(Math.random() * 90000 + 10000)}`;
  let id = "";

  it("lists the PPO number masked, never in full", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/payroll/pensioners", headers: auth(MAKER, OFFICER),
      payload: { ppoNo: PPO, fullName: "Sita Devi", dateOfBirth: "1957-05-05", basicPensionMinor: 3000000, taxRegime: "old", bankAccountNo: "123456789012", bankIfsc: "SBIN0001234", pan: "ABCDE1234F" },
    });
    id = (res.json() as { id: string }).id;
    await until(() => q(sql`SELECT 1 FROM payroll.payroll_pensioners WHERE id = ${id}::uuid`), (r) => r.length > 0);

    const list = await app.inject({ method: "GET", url: "/v1/payroll/pensioners", headers: auth(MAKER, HR_ADMIN) });
    const mine = (list.json() as Array<{ id: string; ppoNo: string; ppoNoMasked: boolean }>).find((p) => p.id === id)!;
    expect(mine.ppoNo).toBe(`••••${PPO.slice(-4)}`);
    expect(mine.ppoNo).not.toContain("PPO");
    expect(mine.ppoNoMasked).toBe(true);
  });

  it("the detail shows masked identifiers only", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/pensioners/${id}`, headers: auth(MAKER, HR_ADMIN) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.panMasked).toBe("ABCDE****F");
    expect(body.bankAccountMasked).toBe("•••• 9012");
    expect(JSON.stringify(body)).not.toContain("123456789012");
    expect(JSON.stringify(body)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(body)).not.toContain(PPO);
  });

  it("reveal is audited with actor + reason, gated to payroll officers, and needs a real reason", async () => {
    expect((await app.inject({ method: "POST", url: `/v1/payroll/pensioners/${id}/reveal`, headers: auth(MAKER, HR_ADMIN), payload: { field: "pan", reason: "Verifying Form 16 details" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/payroll/pensioners/${id}/reveal`, headers: auth(MAKER, OFFICER), payload: { field: "pan", reason: "short" } })).statusCode).toBe(400);

    const res = await app.inject({ method: "POST", url: `/v1/payroll/pensioners/${id}/reveal`, headers: auth(MAKER, OFFICER), payload: { field: "pan", reason: "Verifying Form 16 details" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ field: "pan", value: "ABCDE1234F" });
    expect(res.headers["cache-control"]).toBe("no-store");
    const audit = await until(() => auditsFor(id, "reveal_pii"), (a) => a.length > 0);
    expect(audit[0]!.actor_id).toBe(MAKER);
    expect(audit[0]!.payload).toMatchObject({ field: "pan", reason: "Verifying Form 16 details" });
    expect(JSON.stringify(audit[0]!.payload)).not.toContain("ABCDE1234F"); // the value itself is never logged

    const ppo = await app.inject({ method: "POST", url: `/v1/payroll/pensioners/${id}/reveal`, headers: auth(MAKER, OFFICER), payload: { field: "ppoNo", reason: "Reconciling with the treasury" } });
    expect((ppo.json() as { value: string }).value).toBe(PPO);
  });

  it("does not leak across tenants", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/payroll/pensioners/${id}`, headers: auth(MAKER, OFFICER, OTHER_TENANT) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/payroll/pensioners/${id}/reveal`, headers: auth(MAKER, OFFICER, OTHER_TENANT), payload: { field: "pan", reason: "Verifying Form 16 details" } })).statusCode).toBe(404);
  });

  it("deceased needs a date of death (not in the future); stop then deceased is allowed, deceased is terminal", async () => {
    const noDate = await app.inject({ method: "PATCH", url: `/v1/payroll/pensioners/${id}/status`, headers: auth(MAKER, OFFICER), payload: { status: "deceased", reason: "Death certificate received" } });
    expect(noDate.statusCode).toBe(400);
    const future = await app.inject({ method: "PATCH", url: `/v1/payroll/pensioners/${id}/status`, headers: auth(MAKER, OFFICER), payload: { status: "deceased", reason: "Death certificate received", dateOfDeath: "2999-01-01" } });
    expect(future.statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pensioners/${id}/status`, headers: auth(MAKER, HR_ADMIN), payload: { status: "stopped", reason: "Life certificate not filed" } })).statusCode).toBe(403);

    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pensioners/${id}/status`, headers: auth(MAKER, OFFICER), payload: { status: "stopped", reason: "Life certificate not filed" } })).statusCode).toBe(202);
    await until(() => q(sql`SELECT status FROM payroll.payroll_pensioners WHERE id = ${id}::uuid`), (r) => r[0]?.status === "stopped");
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pensioners/${id}/status`, headers: auth(MAKER, OFFICER), payload: { status: "stopped", reason: "Life certificate not filed" } })).statusCode).toBe(409);

    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pensioners/${id}/status`, headers: auth(MAKER, OFFICER), payload: { status: "deceased", reason: "Death certificate received", dateOfDeath: "2026-09-01" } })).statusCode).toBe(202);
    const row = await until(() => q(sql`SELECT status, status_reason, date_of_death::text AS dod FROM payroll.payroll_pensioners WHERE id = ${id}::uuid`), (r) => r[0]?.status === "deceased");
    expect(row[0]).toMatchObject({ status: "deceased", status_reason: "Death certificate received", dod: "2026-09-01" });
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/pensioners/${id}/status`, headers: auth(MAKER, OFFICER), payload: { status: "stopped", reason: "Life certificate not filed" } })).statusCode).toBe(409);
    const audits = await until(() => auditsFor(id), (a) => a.filter((x) => ["stop_pension", "mark_deceased"].includes(String((x.payload as Record<string, unknown>).action))).length >= 2);
    expect(JSON.stringify(audits.map((a) => a.payload))).not.toContain(PPO);
  });

  it("RACE: two admins deciding the same active pensioner at once -> exactly one transition, exactly one audit", async () => {
    const pid = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_pensioners (id, tenant_id, ppo_no, full_name, date_of_birth, basic_pension_minor, status, created_by, updated_by)
        VALUES (${pid}::uuid, ${TENANT}::uuid, ${"PPO/RACE/" + pid.slice(0, 6)}, 'Race', '1960-01-01', 100, 'active', ${MAKER}::uuid, ${MAKER}::uuid)`);
    }));
    const ctx = (actor: string): RequestContext => ({ tenantId: TENANT, actorId: actor, actorType: "user", roles: OFFICER, correlationId: randomUUID() });
    await Promise.all([
      commands.setPensionerStatus(ctx(MAKER), pid, { from: "active", to: "stopped", reason: "Life certificate not filed", dateOfDeath: null }),
      commands.setPensionerStatus(ctx(CHECKER), pid, { from: "active", to: "deceased", reason: "Death certificate received", dateOfDeath: "2026-09-01" }),
    ]);
    await settle();
    const row = await q(sql`SELECT status FROM payroll.payroll_pensioners WHERE id = ${pid}::uuid`);
    expect(["stopped", "deceased"]).toContain(row[0]?.status);
    const audits = (await auditsFor(pid)).filter((a) => ["stop_pension", "mark_deceased"].includes(String((a.payload as Record<string, unknown>).action)));
    expect(audits).toHaveLength(1);
  });
});

// ─── Salary revisions (GAP-PAYROLL-SALARY-REVISIONS-03/04/05) ───────────────
describe("salary revisions: maker != checker", () => {
  const REVISION = (employeeId: string, over: Record<string, unknown> = {}) => ({
    employeeId, effectiveDate: "2026-04-01", oldBasicMinor: 4000000, newBasicMinor: 4400000,
    oldGrossMinor: 8000000, newGrossMinor: 8800000, revisionType: "annual_increment", orderNo: `ORD-${randomUUID().slice(0, 6)}`, ...over,
  });

  async function create(sub: string, employeeId: string, over: Record<string, unknown> = {}): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/v1/payroll/salary-revisions", headers: auth(sub, OFFICER), payload: REVISION(employeeId, over) });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { id: string }).id;
    await until(() => q(sql`SELECT 1 FROM payroll.payroll_salary_revisions WHERE id = ${id}::uuid`), (r) => r.length > 0);
    return id;
  }
  const status = async (id: string) => (await q(sql`SELECT status, created_by::text AS cb, decided_by::text AS db FROM payroll.payroll_salary_revisions WHERE id = ${id}::uuid`))[0]!;

  it("server validation: new gross below new basic, half-specified old pay, and an unexplained decrease are all 400", async () => {
    const post = (over: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/payroll/salary-revisions", headers: auth(MAKER, OFFICER), payload: REVISION(randomUUID(), over) });
    expect((await post({ newGrossMinor: 4000000 })).statusCode).toBe(400);
    expect((await post({ oldGrossMinor: 0 })).statusCode).toBe(400);
    expect((await post({ newBasicMinor: 3000000, newGrossMinor: 8800000 })).statusCode).toBe(400);
    expect((await post({ newBasicMinor: 3000000, revisionType: "correction" })).statusCode).toBe(202);
  });

  it("starts PENDING by default: no HRMS-sync event, no effect on payroll, then a DIFFERENT user approves", async () => {
    const empId = randomUUID();
    const id = await create(MAKER, empId);
    expect(await status(id)).toMatchObject({ status: "pending", cb: MAKER, db: null });
    expect(await eventsFor("payroll.salary_revision.created", "id", id)).toHaveLength(0);
    expect(await runWithTenant(TENANT, () => db.transaction((tx) => resolveLatestRevision(tx as never, TENANT, empId, "2026-06")))).toBeNull();

    // The creator cannot approve their own revision (route 403) ...
    const self = await app.inject({ method: "PATCH", url: `/v1/payroll/salary-revisions/${id}/approve`, headers: auth(MAKER, ADMIN), payload: {} });
    expect(self.statusCode).toBe(403);
    expect((self.json() as { code: string }).code).toBe("SELF_APPROVAL_FORBIDDEN");
    // ... nor can hr_admin decide at all.
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/salary-revisions/${id}/approve`, headers: auth(CHECKER, HR_ADMIN), payload: {} })).statusCode).toBe(403);

    const ok = await app.inject({ method: "PATCH", url: `/v1/payroll/salary-revisions/${id}/approve`, headers: auth(CHECKER, ADMIN), payload: { note: "Order verified" } });
    expect(ok.statusCode).toBe(202);
    await until(() => status(id), (r) => r.status === "approved");
    expect(await status(id)).toMatchObject({ status: "approved", db: CHECKER });
    expect(await until(() => eventsFor("payroll.salary_revision.created", "id", id), (e) => e.length > 0)).toHaveLength(1);
    const latest = await runWithTenant(TENANT, () => db.transaction((tx) => resolveLatestRevision(tx as never, TENANT, empId, "2026-06")));
    expect(latest?.newBasicMinor).toBe(4400000n);
    expect((await auditsFor(id, "approve"))).toHaveLength(1);

    // already decided -> 409
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/salary-revisions/${id}/approve`, headers: auth(CHECKER_2, ADMIN), payload: {} })).statusCode).toBe(409);
  });

  it("RACE: two approvers deciding at once -> one transition, one HRMS event, one audit; self-decision at the consumer is a no-op", async () => {
    const id = await create(MAKER, randomUUID());
    const ctx = (actor: string): RequestContext => ({ tenantId: TENANT, actorId: actor, actorType: "user", roles: ADMIN, correlationId: randomUUID() });
    await Promise.all([
      commands.decideSalaryRevision(ctx(CHECKER), id, "approved", null),
      commands.decideSalaryRevision(ctx(CHECKER_2), id, "rejected", "Duplicate of another revision"),
    ]);
    await settle();
    const row = await status(id);
    expect(["approved", "rejected"]).toContain(row.status);
    expect(await eventsFor("payroll.salary_revision.created", "id", id)).toHaveLength(row.status === "approved" ? 1 : 0);
    const decisions = (await auditsFor(id)).filter((a) => ["approve", "reject"].includes(String((a.payload as Record<string, unknown>).action)));
    expect(decisions).toHaveLength(1);

    // consumer-level self-approval guard (bypassing the route's pre-check)
    const id2 = await create(MAKER, randomUUID());
    await commands.decideSalaryRevision(ctx(MAKER), id2, "approved", null);
    await settle();
    expect((await status(id2)).status).toBe("pending");
  });

  it("a rejection needs a reason and never reaches HRMS or payroll", async () => {
    const empId = randomUUID();
    const id = await create(MAKER, empId);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/salary-revisions/${id}/reject`, headers: auth(CHECKER, ADMIN), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/salary-revisions/${id}/reject`, headers: auth(CHECKER, ADMIN), payload: { note: "Order number does not match" } })).statusCode).toBe(202);
    await until(() => status(id), (r) => r.status === "rejected");
    expect(await eventsFor("payroll.salary_revision.created", "id", id)).toHaveLength(0);
    expect(await runWithTenant(TENANT, () => db.transaction((tx) => resolveLatestRevision(tx as never, TENANT, empId, "2026-06")))).toBeNull();
  });

  it("with the per-tenant switch OFF a revision is approved immediately (legacy behaviour)", async () => {
    const tenant = randomUUID();
    const put = await app.inject({ method: "PUT", url: "/v1/payroll/settings", headers: auth(MAKER, ADMIN, tenant), payload: { protectedNetFloorMinor: 0, salaryRevisionSecondApprover: false } });
    expect(put.statusCode).toBe(202);
    await until(() => q(sql`SELECT salary_revision_second_approver AS s FROM payroll.payroll_settings`, tenant), (r) => r.length > 0);
    const settings = await app.inject({ method: "GET", url: "/v1/payroll/settings", headers: auth(MAKER, ADMIN, tenant) });
    expect((settings.json() as { salaryRevisionSecondApprover: boolean }).salaryRevisionSecondApprover).toBe(false);

    const res = await app.inject({ method: "POST", url: "/v1/payroll/salary-revisions", headers: auth(MAKER, OFFICER, tenant), payload: REVISION(randomUUID()) });
    const id = (res.json() as { id: string }).id;
    const row = await until(() => q(sql`SELECT status FROM payroll.payroll_salary_revisions WHERE id = ${id}::uuid`, tenant), (r) => r.length > 0);
    expect(row[0]?.status).toBe("approved");
    expect(await q(sql`SELECT payload FROM _outbox.messages WHERE topic = 'payroll.salary_revision.created' AND payload->>'id' = ${id}`, tenant)).toHaveLength(1);

    // and the default for a tenant that never set it is ON
    const fresh = await app.inject({ method: "GET", url: "/v1/payroll/settings", headers: auth(MAKER, ADMIN, randomUUID()) });
    expect((fresh.json() as { salaryRevisionSecondApprover: boolean }).salaryRevisionSecondApprover).toBe(true);
  });

  it("reading pay history is role-gated and audited (who looked)", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/payroll/salary-revisions", headers: auth(EMP_USER, ["employee"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/salary-revisions", headers: auth(MAKER, ["finance_officer"]) })).statusCode).toBe(403);
    const empId = randomUUID();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/salary-revisions?employeeId=${empId}`, headers: auth(CHECKER_2, HR_ADMIN) });
    expect(res.statusCode).toBe(200);
    const audit = await until(() => auditsFor(empId, "read_pay_history"), (a) => a.length > 0);
    expect(audit[0]!.actor_id).toBe(CHECKER_2);
  });
});

// ─── Reimbursement receipts (GAP-PAYROLL-REIMBURSEMENTS-03) ─────────────────
describe("reimbursement receipts", () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    employeeId: EMP_ID, category: "medical", amountMinor: 250000, period: "2026-08", billRef: "BILL-1", ...over,
  });

  it("presign returns a tenant-scoped private key and only accepts PDF / JPEG / PNG up to 10 MB", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(EMP_USER, ["employee"]), payload: { filename: "bill 1.pdf", contentType: "application/pdf", sizeBytes: 1024 } });
    expect(res.statusCode).toBe(200);
    const b = res.json() as { storageKey: string; uploadUrl: string };
    expect(b.storageKey.startsWith(`payroll/${TENANT}/reimbursements/${EMP_USER}/`)).toBe(true);
    expect(b.storageKey.endsWith("/bill_1.pdf")).toBe(true);
    expect(b.uploadUrl).toContain(b.storageKey);
    for (const payload of [
      { filename: "x.exe", contentType: "application/x-msdownload", sizeBytes: 10 },
      { filename: "big.pdf", contentType: "application/pdf", sizeBytes: 11 * 1024 * 1024 },
    ]) {
      expect((await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(EMP_USER, ["employee"]), payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(MAKER, ["finance_officer"]), payload: { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 1 } })).statusCode).toBe(403);
  });

  it("stores the receipt keys with the claim, lists a COUNT (never the keys), and serves audited short-lived links to staff or the claimant only", async () => {
    const presign = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(EMP_USER, ["employee"]), payload: { filename: "bill.pdf", contentType: "application/pdf", sizeBytes: 2048 } });
    const key = (presign.json() as { storageKey: string }).storageKey;

    // not uploaded yet -> rejected
    const early = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ attachmentKeys: [key] }) });
    expect(early.statusCode).toBe(400);
    expect((early.json() as { code: string }).code).toBe("ATTACHMENT_NOT_UPLOADED");
    // a key outside this tenant's prefix -> rejected
    const foreign = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ attachmentKeys: [`payroll/${OTHER_TENANT}/reimbursements/x/y/bill.pdf`] }) });
    expect(foreign.statusCode).toBe(422);
    expect((foreign.json() as { code: string }).code).toBe("RECEIPT_KEY_INVALID");

    upload(key);
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ attachmentKeys: [key] }) });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { id: string }).id;
    const stored = await until(() => q(sql`SELECT attachment_keys FROM payroll.payroll_reimbursements WHERE id = ${id}::uuid`), (r) => r.length > 0);
    expect(stored[0]!.attachment_keys).toEqual([key]);

    const list = await app.inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: auth(MAKER, OFFICER) });
    const row = (list.json() as { data: Array<Record<string, unknown>> }).data.find((r) => r.id === id)!;
    expect(row.attachment_count).toBe(1);
    expect(row).not.toHaveProperty("attachment_keys");
    expect(JSON.stringify(list.json())).not.toContain(key);

    const view = await app.inject({ method: "GET", url: `/v1/payroll/reimbursements/${id}/attachments`, headers: auth(MAKER, OFFICER) });
    expect(view.statusCode).toBe(200);
    expect((view.json() as { data: Array<{ url: string; filename: string }> }).data[0]).toMatchObject({ filename: "bill.pdf" });
    expect((view.json() as { data: Array<{ url: string }> }).data[0]!.url).toContain("sig=2");
    const audit = await until(() => auditsFor(id, "view_attachments"), (a) => a.length > 0);
    expect(audit[0]!.actor_id).toBe(MAKER);

    // the claimant can view their own; another employee cannot; cross-tenant is a 404
    expect((await app.inject({ method: "GET", url: `/v1/payroll/reimbursements/${id}/attachments`, headers: auth(EMP_USER, ["employee"]) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/payroll/reimbursements/${id}/attachments`, headers: auth(OTHER_EMP_USER, ["employee"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/payroll/reimbursements/${id}/attachments`, headers: auth(MAKER, OFFICER, OTHER_TENANT) })).statusCode).toBe(404);
  });

  it("a category that needs no receipt is accepted without one", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ category: "food" }) });
    expect(res.statusCode).toBe(202);
  });

  it.each(["medical", "lta", "travel"])("SERVER-ENFORCED: a %s claim with no receipt is 422 RECEIPT_REQUIRED and nothing is queued or stored", async (category) => {
    const publish = vi.spyOn(queue as unknown as { publish: (...a: unknown[]) => Promise<unknown> }, "publish");
    const ref = `NOREC-${category}-${randomUUID().slice(0, 6)}`;
    for (const extra of [{}, { attachmentKeys: [] }]) {
      const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ category, billRef: ref, ...extra }) });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { code: string }).code).toBe("RECEIPT_REQUIRED");
    }
    // admin filing on someone's behalf is held to the same rule
    const admin = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(MAKER, OFFICER), payload: claim({ category, billRef: ref }) });
    expect(admin.statusCode).toBe(422);
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
    await settle();
    expect(await q(sql`SELECT 1 FROM payroll.payroll_reimbursements WHERE bill_ref = ${ref}`)).toHaveLength(0);
  });

  it("a medical claim with a valid receipt key issued to the submitter is accepted", async () => {
    const presign = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(EMP_USER, ["employee"]), payload: { filename: "ok.pdf", contentType: "application/pdf", sizeBytes: 100 } });
    const key = (presign.json() as { storageKey: string }).storageKey;
    upload(key);
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ category: "medical", attachmentKeys: [key] }) });
    expect(res.statusCode).toBe(202);
  });

  it("a key issued to ANOTHER claimant (same tenant) is 422, even if the object exists", async () => {
    const presign = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(OTHER_EMP_USER, ["employee"]), payload: { filename: "theirs.pdf", contentType: "application/pdf", sizeBytes: 100 } });
    const key = (presign.json() as { storageKey: string }).storageKey;
    upload(key);
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ category: "medical", attachmentKeys: [key] }) });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("RECEIPT_KEY_INVALID");
    // forged traversal inside the claimant's own prefix
    const forged = `payroll/${TENANT}/reimbursements/${EMP_USER}/../${OTHER_EMP_USER}/x/theirs.pdf`;
    upload(forged);
    expect((await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ category: "travel", attachmentKeys: [forged] }) })).statusCode).toBe(422);
  });

  it("the stored object is HEADed: oversize or non-PDF/JPEG/PNG receipts are 422 RECEIPT_FILE_INVALID", async () => {
    const mk = async (name: string, over: Partial<{ contentLength: number; contentType: string }>) => {
      const presign = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(EMP_USER, ["employee"]), payload: { filename: name, contentType: "application/pdf", sizeBytes: 100 } });
      const key = (presign.json() as { storageKey: string }).storageKey;
      upload(key, over);
      return app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ category: "medical", attachmentKeys: [key] }) });
    };
    for (const over of [{ contentLength: 10 * 1024 * 1024 + 1 }, { contentLength: 0 }, { contentType: "application/x-msdownload" }, { contentType: "text/html" }]) {
      const res = await mk("bad.pdf", over);
      expect(res.statusCode).toBe(422);
      expect((res.json() as { code: string }).code).toBe("RECEIPT_FILE_INVALID");
    }
    expect((await mk("max.pdf", { contentLength: 10 * 1024 * 1024 })).statusCode).toBe(202);
    expect((await mk("img.png", { contentType: "image/png" })).statusCode).toBe(202);
    expect((await mk("charset.pdf", { contentType: "application/pdf; charset=binary" })).statusCode).toBe(202);
  });

  it("the presign signs the declared size (contentLength) and the reveal / receipt-view responses are no-store", async () => {
    const storage = await import("@civitasone/storage");
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(EMP_USER, ["employee"]), payload: { filename: "s.pdf", contentType: "application/pdf", sizeBytes: 4321 } });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(storage.presignedPutUrl).mock.calls.at(-1)![0]).toMatchObject({ contentType: "application/pdf", contentLength: 4321 });

    const key = (res.json() as { storageKey: string }).storageKey;
    upload(key);
    const created = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(EMP_USER, ["employee"]), payload: claim({ category: "medical", attachmentKeys: [key] }) });
    const id = (created.json() as { id: string }).id;
    await until(() => q(sql`SELECT 1 FROM payroll.payroll_reimbursements WHERE id = ${id}::uuid`), (r) => r.length > 0);
    const view = await app.inject({ method: "GET", url: `/v1/payroll/reimbursements/${id}/attachments`, headers: auth(MAKER, OFFICER) });
    expect(view.headers["cache-control"]).toBe("no-store");
  });

  it("the consumer re-asserts the rule when the command is published without the route (nothing inserted)", async () => {
    const ref = `DIRECT-${randomUUID().slice(0, 6)}`;
    const id = randomUUID();
    const base = { id, tenantId: TENANT, employeeId: EMP_ID, amountMinor: 100, period: "2026-08", billRef: ref };
    const publish = (payload: Record<string, unknown>) => (queue as unknown as { publish: (t: string, m: unknown) => Promise<void> }).publish("payroll.reimbursement.create", {
      messageId: randomUUID(), type: "payroll.reimbursement.create", tenantId: TENANT, actorId: EMP_USER, correlationId: randomUUID(), schemaVersion: "1.0", payload,
    });
    await publish({ ...base, category: "medical" });
    await publish({ ...base, id: randomUUID(), category: "lta", attachmentKeys: [`payroll/${OTHER_TENANT}/reimbursements/${EMP_USER}/u/x.pdf`] });
    await settle();
    expect(await q(sql`SELECT 1 FROM payroll.payroll_reimbursements WHERE bill_ref = ${ref}`)).toHaveLength(0);
    // a legitimate non-receipt category still goes through the same path
    await publish({ ...base, id: randomUUID(), category: "food", billRef: ref + "-ok" });
    expect(await until(() => q(sql`SELECT 1 FROM payroll.payroll_reimbursements WHERE bill_ref = ${ref + "-ok"}`), (r) => r.length > 0)).toHaveLength(1);
  });
});

// ─── PT slabs (GAP-PAYROLL-STATUTORY-PT-04) ─────────────────────────────────
describe("PT state rules: state codes", () => {
  it("rejects a code that is not a state / UT, and refuses PT slabs on state-rules (versioned: pt-versions-real-db.test.ts)", async () => {
    const zz = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(MAKER, OFFICER), payload: { stateCode: "ZZ", lwfEmployee: 100 } });
    expect(zz.statusCode).toBe(400);
    const slabs = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(MAKER, OFFICER), payload: { stateCode: "GJ", ptSlabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 0 }] } });
    expect(slabs.statusCode).toBe(422);
    expect((slabs.json() as { code: string }).code).toBe("PT_SLABS_USE_VERSIONS");
  });
});

// ─── Settings audit (second-approver switch) ────────────────────────────────
describe("payroll settings audit includes the second-approver switch", () => {
  it("records salaryRevisionSecondApprover before (default true when there was no row) and after", async () => {
    const tenant = randomUUID();
    const put = (payload: Record<string, unknown>) => app.inject({ method: "PUT", url: "/v1/payroll/settings", headers: auth(MAKER, ADMIN, tenant), payload });
    expect((await put({ protectedNetFloorMinor: 0, salaryRevisionSecondApprover: false })).statusCode).toBe(202);
    const audits = async () => (await q(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${tenant} ORDER BY created_at`, tenant)).map((r) => r.payload as { before: Record<string, unknown> | null; after: Record<string, unknown> });
    const first = await until(audits, (a) => a.length >= 1);
    expect(first[0]!.before).toBeNull(); // no row yet
    expect(first[0]!.after.salaryRevisionSecondApprover).toBe(false);

    // an update that does not mention the switch keeps it and still reports it on both sides
    expect((await put({ protectedNetFloorMinor: 100 })).statusCode).toBe(202);
    const second = await until(audits, (a) => a.length >= 2);
    expect(second[1]!.before!.salaryRevisionSecondApprover).toBe(false);
    expect(second[1]!.after.salaryRevisionSecondApprover).toBe(false);

    // turning it back on
    expect((await put({ protectedNetFloorMinor: 100, salaryRevisionSecondApprover: true })).statusCode).toBe(202);
    const third = await until(audits, (a) => a.length >= 3);
    expect(third[2]!.before!.salaryRevisionSecondApprover).toBe(false);
    expect(third[2]!.after.salaryRevisionSecondApprover).toBe(true);
  });

  it("a pre-existing settings row (switch never set) reads as ON in the before snapshot", async () => {
    const tenant = randomUUID();
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, protected_net_floor_minor) VALUES (${tenant}::uuid, 0)`);
    }));
    expect((await app.inject({ method: "PUT", url: "/v1/payroll/settings", headers: auth(MAKER, ADMIN, tenant), payload: { protectedNetFloorMinor: 50 } })).statusCode).toBe(202);
    const rows = await until(() => q(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${tenant}`, tenant), (r) => r.length > 0);
    const p = rows[0]!.payload as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(p.before.salaryRevisionSecondApprover).toBe(true);
    expect(p.after.salaryRevisionSecondApprover).toBe(true);
  });
});
