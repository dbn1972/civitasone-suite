/**
 * S8-G4 -- private grade bands, real DB (RLS + FK + HTTP + queue consumers, no mocks).
 *
 * Two tenants share one database:
 *   GOV  -- never touches the new setting (pay_scale defaults to 'cpc7'): proves it behaves exactly as before.
 *   BAND -- switches pay_scale.kind to 'private_bands': proves the new behaviour.
 * Per REL-035 (vitest.config.ts) DATABASE_URL must point at a disposable Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPolicySettingsConsumers } from "../src/modules/policy-settings/consumer.js";
import { registerGradeBandConsumers } from "../src/modules/grade-bands/consumer.js";
import { registerF3_employee_Consumers } from "../src/modules/employee/f3-consumer.js";

registerPolicySettingsConsumers(queue);
registerGradeBandConsumers(queue);
registerF3_employee_Consumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

// vitest.config.ts injects JWT_SECRET for every test; no literal is kept here.
const SECRET = process.env.JWT_SECRET as string;
const GOV = randomUUID();
const BAND = randomUUID();
const ACTOR = randomUUID();
const DEPT = { [GOV]: randomUUID(), [BAND]: randomUUID() } as Record<string, string>;

const tok = (tid: string, roles: string[], sub = ACTOR) => signToken({ sub, tid, roles, sid: "sess-g4" }, SECRET);
const as = (tid: string, roles = ["hr_admin"], sub = ACTOR) => ({ authorization: `Bearer ${tok(tid, roles, sub)}` });
const asTenant = <T>(tid: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, tid, fn);

let app: Awaited<ReturnType<typeof buildApp>>;

async function cleanup(): Promise<void> {
  for (const tid of [GOV, BAND]) {
    await asTenant(tid, (tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tid} AND payload->>'resourceType' = 'grade_band'`);
    await asTenant(tid, (tx) => tx`DELETE FROM attendance.hrms_wfh_requests WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_policy_settings WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_grade_bands WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${tid}`);
  }
}

async function seedDept(tid: string): Promise<void> {
  await asTenant(tid, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT[tid]!}, ${tid}, 'D1', 'G4 Dept', ${ACTOR}, ${ACTOR})`);
}

async function seedEmployee(tid: string, no: string, designationId: string): Promise<string> {
  const id = randomUUID();
  await asTenant(tid, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
    VALUES (${id}, ${tid}, ${no}, ${no}, ${DEPT[tid]!}, ${designationId}, '2015-01-01', 'permanent', ${id}, ${ACTOR}, ${ACTOR})`);
  return id;
}

const putPolicy = async (tid: string, key: string, payload: Record<string, unknown>) => {
  const r = await app.inject({ method: "PUT", url: `/v1/hrms/policy-settings/${key}`, headers: as(tid), payload });
  expect(r.statusCode).toBe(202);
  await drain();
};
const mkBand = async (tid: string, payload: Record<string, unknown>) => {
  const r = await app.inject({ method: "POST", url: "/v1/hrms/admin/grade-bands", headers: as(tid), payload });
  expect(r.statusCode).toBe(202);
  await drain();
  return r.json().id as string;
};
const postDesig = async (tid: string, payload: Record<string, unknown>) => {
  const r = await app.inject({ method: "POST", url: "/v1/hrms/designations", headers: as(tid), payload });
  if (r.statusCode === 202) await drain();
  return r;
};
const desigRow = async (tid: string, code: string) =>
  (await asTenant(tid, (tx) => tx`SELECT id, level, grade_band_id FROM employee.hrms_designations WHERE tenant_id = ${tid} AND code = ${code}`))[0] as
    { id: string; level: number; grade_band_id: string | null } | undefined;
const feed = async (tid: string) => {
  const r = await app.inject({ method: "GET", url: "/v1/hrms/internal/payroll-input?month=2026-11", headers: as(tid) });
  expect(r.statusCode).toBe(200);
  return (r.json().employees ?? r.json().data?.employees) as Array<Record<string, unknown>>;
};

beforeAll(async () => {
  await cleanup();
  await seedDept(GOV);
  await seedDept(BAND);
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

// ──────────────────────────────────────────────────────────────────────────────
describe("government tenant (pay_scale left at its default 'cpc7') behaves exactly as before", () => {
  it("still rejects a designation level outside 1-18 with the original message and field", async () => {
    const r = await postDesig(GOV, { code: "G40", name: "Level forty", level: 40 });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: [{ field: "level", message: "Pay level must be between 1 and 18." }] });
    expect(await desigRow(GOV, "G40")).toBeUndefined();
  });

  it("accepts level 12, stores no band, and still allows the PATCH 'unclassified' 0 but not 19", async () => {
    expect((await postDesig(GOV, { code: "L12", name: "Section Officer", level: 12 })).statusCode).toBe(202);
    const row = await desigRow(GOV, "L12");
    expect(row).toMatchObject({ level: 12, grade_band_id: null });
    const zero = await app.inject({ method: "PATCH", url: `/v1/hrms/designations/${row!.id}`, headers: as(GOV), payload: { level: 0 } });
    expect(zero.statusCode).toBe(202);
    await drain();
    expect((await desigRow(GOV, "L12"))!.level).toBe(0);
    const high = await app.inject({ method: "PATCH", url: `/v1/hrms/designations/${row!.id}`, headers: as(GOV), payload: { level: 19 } });
    expect(high.statusCode).toBe(400);
    await app.inject({ method: "PATCH", url: `/v1/hrms/designations/${row!.id}`, headers: as(GOV), payload: { level: 12 } });
    await drain();
  });

  it("the policy default is cpc7 and the band switch is NOT on", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/policy-settings", headers: as(GOV) });
    const row = r.json().data.find((p: { key: string }) => p.key === "pay_scale");
    expect(row).toMatchObject({ isDefault: true, value: { kind: "cpc7" } });
  });

  it("the payroll feed carries payLevel/payGrade and NO gradeBand key; WFH still keys off the level", async () => {
    const d = (await desigRow(GOV, "L12"))!;
    const emp = await seedEmployee(GOV, "GOV-12", d.id);
    const e = (await feed(GOV)).find((x) => x.id === emp)!;
    expect(e.payLevel).toBe(12);
    expect(Object.keys(e)).not.toContain("gradeBand");
    const el = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${emp}`, headers: as(GOV, ["employee"], emp) });
    expect(el.json()).toMatchObject({ payLevel: 12, maxPayLevel: 9, gazetted: true, payScale: "cpc7", bandRank: null });
    const req = await app.inject({ method: "POST", url: "/v1/hrms/wfh-requests", headers: as(GOV, ["employee"], emp), payload: { employeeId: emp, fromDate: "2026-11-02", toDate: "2026-11-02" } });
    expect(req.statusCode).toBe(422);
    expect(req.json()).toMatchObject({ code: "GAZETTED_NOT_ELIGIBLE", message: "work from home is not available at pay Level 12 (eligible up to Level 9)" });
  });

  it("even if a government tenant defines and links a band, nothing reads it until it switches the setting on", async () => {
    const band = await mkBand(GOV, { code: "x1", name: "Stray band", rank: 99 });
    const link = await postDesig(GOV, { code: "L5", name: "Clerk", level: 5, gradeBandId: band });
    expect(link.statusCode).toBe(202);
    const emp = await seedEmployee(GOV, "GOV-05", (await desigRow(GOV, "L5"))!.id);
    const e = (await feed(GOV)).find((x) => x.id === emp)!;
    expect(Object.keys(e)).not.toContain("gradeBand");
    expect(e.payLevel).toBe(5);
    const el = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${emp}`, headers: as(GOV, ["employee"], emp) });
    expect(el.json()).toMatchObject({ payLevel: 5, gazetted: false, payScale: "cpc7" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe("grade-band API (band tenant)", () => {
  let c2: string; let t3: string; let m2: string;

  it("before the switch the 1-18 rule still applies to this tenant too", async () => {
    const r = await postDesig(BAND, { code: "OLD", name: "Before switch", level: 40 });
    expect(r.statusCode).toBe(400);
  });

  it("only HR admins can change the pay-scale setting; then the 1-18 rule is relaxed for this tenant", async () => {
    const denied = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/pay_scale", headers: as(BAND, ["employee"]), payload: { kind: "private_bands" } });
    expect(denied.statusCode).toBe(403);
    const bad = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/pay_scale", headers: as(BAND), payload: { kind: "pay_matrix_9000" } });
    expect(bad.statusCode).toBe(400);
    await putPolicy(BAND, "pay_scale", { kind: "private_bands" });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/policy-settings", headers: as(BAND, ["hr_officer"]) });
    expect(r.json().data.find((p: { key: string }) => p.key === "pay_scale")).toMatchObject({ isDefault: false, value: { kind: "private_bands" } });
  });

  it("creates bands (code upper-cased), rejects duplicates case-insensitively, bad ranges and bad CTC", async () => {
    c2 = await mkBand(BAND, { code: "c2", name: "Consultant 2", rank: 20, track: "Technical", noticeDays: 30 });
    t3 = await mkBand(BAND, { code: "T3", name: "Technical Lead", rank: 30, track: "Technical", ctcMinMinor: 1200000000, ctcMaxMinor: "1800000000" });
    m2 = await mkBand(BAND, { code: "M2", name: "Manager 2", rank: 40, track: "Managerial" });
    const dupe = await app.inject({ method: "POST", url: "/v1/hrms/admin/grade-bands", headers: as(BAND), payload: { code: "C2", name: "Again", rank: 21 } });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json()).toMatchObject({ code: "DUPLICATE_CODE", fieldErrors: [{ field: "code" }] });
    for (const payload of [
      { code: "Z9", name: "Zero rank", rank: 0 },
      { code: "Z9", name: "Huge rank", rank: 10000 },
      { code: "bad code", name: "Space in code", rank: 5 },
      { code: "Z9", name: "Inverted", rank: 5, ctcMinMinor: 200, ctcMaxMinor: 100 },
      { code: "Z9", name: "Negative", rank: 5, ctcMinMinor: -1 },
      { code: "Z9", name: "Unknown field", rank: 5, colour: "red" },
    ]) {
      const r = await app.inject({ method: "POST", url: "/v1/hrms/admin/grade-bands", headers: as(BAND), payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("lists by rank with money as strings and a designation count; the code is stored upper-case", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/admin/grade-bands", headers: as(BAND, ["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    const data = r.json().data as Array<Record<string, unknown>>;
    expect(data.map((b) => b.code)).toEqual(["C2", "T3", "M2"]);
    expect(data[1]).toMatchObject({ ctcMinMinor: "1200000000", ctcMaxMinor: "1800000000", designationCount: 0, isActive: true });
    expect(data[0]).toMatchObject({ ctcMinMinor: null, noticeDays: 30, track: "Technical" });
  });

  it("role guard: employees cannot read or write; hr_officer reads but cannot write", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/hrms/admin/grade-bands", headers: as(BAND, ["employee"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/hrms/admin/grade-bands", headers: as(BAND, ["hr_officer"]), payload: { code: "Q1", name: "Nope", rank: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/v1/hrms/admin/grade-bands/${c2}`, headers: as(BAND, ["hr_officer"]), payload: { name: "Nope" } })).statusCode).toBe(403);
  });

  it("patches with an optimistic lock, validates the range against the stored row, and refuses a stale version", async () => {
    const ok = await app.inject({ method: "PATCH", url: `/v1/hrms/admin/grade-bands/${c2}`, headers: as(BAND), payload: { name: "Consultant II", rank: 22, expectedVersion: 1 } });
    expect(ok.statusCode).toBe(202);
    await drain();
    const stale = await app.inject({ method: "PATCH", url: `/v1/hrms/admin/grade-bands/${c2}`, headers: as(BAND), payload: { name: "Late", expectedVersion: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    // T3 has a stored max of 1,800,000,000: raising the min above it must fail even though only min was sent
    const range = await app.inject({ method: "PATCH", url: `/v1/hrms/admin/grade-bands/${t3}`, headers: as(BAND), payload: { ctcMinMinor: "1900000000" } });
    expect(range.statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/v1/hrms/admin/grade-bands/${c2}`, headers: as(BAND), payload: { code: "NEW" } })).statusCode).toBe(400); // the code is immutable
    expect((await app.inject({ method: "PATCH", url: `/v1/hrms/admin/grade-bands/${randomUUID()}`, headers: as(BAND), payload: { name: "Ghost" } })).statusCode).toBe(404);
    const row = (await asTenant(BAND, (tx) => tx`SELECT name, rank, version FROM employee.hrms_grade_bands WHERE id = ${c2}`))[0]!;
    expect(row).toMatchObject({ name: "Consultant II", rank: 22, version: 2 });
  });

  it("designations: level 40 is accepted (unused) and the band link is stored; level 100 is still a typo", async () => {
    expect((await postDesig(BAND, { code: "SE", name: "Senior Engineer", level: 40, gradeBandId: t3 })).statusCode).toBe(202);
    expect(await desigRow(BAND, "SE")).toMatchObject({ level: 40, grade_band_id: t3 });
    expect((await postDesig(BAND, { code: "ENG", name: "Engineer", gradeBandId: c2 })).statusCode).toBe(202);
    expect(await desigRow(BAND, "ENG")).toMatchObject({ level: 0, grade_band_id: c2 });
    expect((await postDesig(BAND, { code: "MGR", name: "Manager", gradeBandId: m2 })).statusCode).toBe(202);
    const r = await postDesig(BAND, { code: "BAD", name: "Typo level", level: 100 });
    expect(r.statusCode).toBe(400);
  });

  it("PATCH can move a designation to another band, clear it with null, and level 40 is accepted on PATCH too", async () => {
    const d = (await desigRow(BAND, "ENG"))!;
    const move = await app.inject({ method: "PATCH", url: `/v1/hrms/designations/${d.id}`, headers: as(BAND), payload: { gradeBandId: t3, level: 55 } });
    expect(move.statusCode).toBe(202);
    await drain();
    expect(await desigRow(BAND, "ENG")).toMatchObject({ grade_band_id: t3, level: 55 });
    const clear = await app.inject({ method: "PATCH", url: `/v1/hrms/designations/${d.id}`, headers: as(BAND), payload: { gradeBandId: null } });
    expect(clear.statusCode).toBe(202);
    await drain();
    expect((await desigRow(BAND, "ENG"))!.grade_band_id).toBeNull();
    await app.inject({ method: "PATCH", url: `/v1/hrms/designations/${d.id}`, headers: as(BAND), payload: { gradeBandId: c2 } });
    await drain();
  });

  it("refuses a band that does not exist, is inactive, or belongs to another tenant", async () => {
    const ghost = await postDesig(BAND, { code: "G1", name: "Ghost band", gradeBandId: randomUUID() });
    expect(ghost.statusCode).toBe(422);
    expect(ghost.json().code).toBe("GRADE_BAND_NOT_FOUND");
    const govBand = (await asTenant(GOV, (tx) => tx`SELECT id FROM employee.hrms_grade_bands WHERE tenant_id = ${GOV} LIMIT 1`))[0]!.id as string;
    const foreign = await postDesig(BAND, { code: "G2", name: "Foreign band", gradeBandId: govBand });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json().code).toBe("GRADE_BAND_NOT_FOUND");
    const spare = await mkBand(BAND, { code: "S1", name: "Spare", rank: 5 });
    expect((await app.inject({ method: "POST", url: `/v1/hrms/admin/grade-bands/${spare}/deactivate`, headers: as(BAND) })).statusCode).toBe(202);
    await drain();
    const inactive = await postDesig(BAND, { code: "G3", name: "Inactive band", gradeBandId: spare });
    expect(inactive.statusCode).toBe(422);
    expect(inactive.json().code).toBe("GRADE_BAND_INACTIVE");
    expect((await app.inject({ method: "POST", url: `/v1/hrms/admin/grade-bands/${spare}/deactivate`, headers: as(BAND) })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/admin/grade-bands/${spare}/reactivate`, headers: as(BAND) })).statusCode).toBe(202);
    await drain();
    // an unused band can be deleted; a used one cannot
    expect((await app.inject({ method: "DELETE", url: `/v1/hrms/admin/grade-bands/${spare}`, headers: as(BAND) })).statusCode).toBe(202);
    await drain();
    expect((await asTenant(BAND, (tx) => tx`SELECT 1 FROM employee.hrms_grade_bands WHERE id = ${spare}`)).length).toBe(0);
    const inUse = await app.inject({ method: "DELETE", url: `/v1/hrms/admin/grade-bands/${c2}`, headers: as(BAND) });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json()).toMatchObject({ code: "BAND_IN_USE", count: 1 });
  });

  it("a deactivated band stays on the designations that already use it and shows in the list", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/admin/grade-bands?includeInactive=false", headers: as(BAND) });
    expect((r.json().data as unknown[]).length).toBe(3);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/admin/grade-bands/${m2}/deactivate`, headers: as(BAND) })).statusCode).toBe(202);
    await drain();
    expect((await desigRow(BAND, "MGR"))!.grade_band_id).toBe(m2);
    const all = await app.inject({ method: "GET", url: "/v1/hrms/admin/grade-bands", headers: as(BAND) });
    expect((all.json().data as Array<{ code: string; isActive: boolean }>).find((b) => b.code === "M2")).toMatchObject({ isActive: false, designationCount: 1 });
    const only = await app.inject({ method: "GET", url: "/v1/hrms/admin/grade-bands?includeInactive=false", headers: as(BAND) });
    expect((only.json().data as unknown[]).length).toBe(2);
    await app.inject({ method: "POST", url: `/v1/hrms/admin/grade-bands/${m2}/reactivate`, headers: as(BAND) });
    await drain();
  });

  it("every write leaves an audit event in the same transaction: create, update, (de)activate and delete", async () => {
    const rows = await asTenant(BAND, (tx) => tx`
      SELECT payload->>'action' AS action, payload->>'outcome' AS outcome, payload->'metadata'->>'code' AS code
        FROM _outbox.messages
       WHERE tenant_id = ${BAND} AND topic = 'audit.event.record' AND payload->>'resourceType' = 'grade_band'`);
    const seen = new Set(rows.map((r) => `${r.action}:${r.outcome}`));
    for (const k of ["create:success", "update:success", "deactivate:success", "reactivate:success", "delete:success"]) expect(seen.has(k), k).toBe(true);
    expect(rows.filter((r) => r.action === "create" && r.outcome === "success").map((r) => r.code).sort()).toEqual(["C2", "M2", "S1", "T3"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe("rank consumers on a band tenant", () => {
  let eC2: string; let eM2: string; let eNone: string;

  it("seeds one employee per band plus one on a designation with no band", async () => {
    const bands = await asTenant(BAND, (tx) => tx`SELECT code, id FROM employee.hrms_grade_bands WHERE tenant_id = ${BAND}`);
    const byCode = Object.fromEntries(bands.map((b) => [b.code as string, b.id as string]));
    await postDesig(BAND, { code: "C2D", name: "C2 role", gradeBandId: byCode.C2 });
    await postDesig(BAND, { code: "M2D", name: "M2 role", gradeBandId: byCode.M2 });
    await postDesig(BAND, { code: "NOB", name: "No band", level: 12 });
    eC2 = await seedEmployee(BAND, "B-C2", (await desigRow(BAND, "C2D"))!.id);
    eM2 = await seedEmployee(BAND, "B-M2", (await desigRow(BAND, "M2D"))!.id);
    eNone = await seedEmployee(BAND, "B-NO", (await desigRow(BAND, "NOB"))!.id);
  });

  it("payroll feed: gradeBand {code,name,rank} for banded designations, no key otherwise; payLevel untouched", async () => {
    const f = await feed(BAND);
    expect(f.find((x) => x.id === eC2)!.gradeBand).toEqual({ code: "C2", name: "Consultant II", rank: 22 });
    expect(f.find((x) => x.id === eM2)!.gradeBand).toEqual({ code: "M2", name: "Manager 2", rank: 40 });
    const none = f.find((x) => x.id === eNone)!;
    expect(Object.keys(none)).not.toContain("gradeBand");
    expect(none.payLevel).toBe(12);
  });

  it("WFH: with the default policy nobody on a band tenant is excluded (no gazetted rule for a company)", async () => {
    const el = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${eM2}`, headers: as(BAND, ["employee"], eM2) });
    expect(el.json()).toMatchObject({ payScale: "private_bands", bandCode: "M2", bandRank: 40, maxBandRank: null, gazetted: false });
    // the unclassified Level-12 designation on a band tenant is not blocked by the CPC threshold either
    const none = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${eNone}`, headers: as(BAND, ["employee"], eNone) });
    expect(none.json()).toMatchObject({ payScale: "private_bands", bandRank: null, gazetted: false });
  });

  it("WFH: a tenant-chosen maxBandRank excludes by band rank and never by the CPC level", async () => {
    await putPolicy(BAND, "wfh_eligibility", { enforceGazettedExclusion: true, maxPayLevel: 9, maxBandRank: 30 });
    const m2 = await app.inject({ method: "POST", url: "/v1/hrms/wfh-requests", headers: as(BAND, ["employee"], eM2), payload: { employeeId: eM2, fromDate: "2026-11-02", toDate: "2026-11-02" } });
    expect(m2.statusCode).toBe(422);
    expect(m2.json().code).toBe("GAZETTED_NOT_ELIGIBLE");
    expect(m2.json().message).toContain("M2");
    expect((await app.inject({ method: "POST", url: "/v1/hrms/wfh-requests", headers: as(BAND, ["employee"], eC2), payload: { employeeId: eC2, fromDate: "2026-11-02", toDate: "2026-11-02" } })).statusCode).toBe(202);
    // Level 12 on a band tenant: unclassified by band, so allowed (the CPC level is not consulted)
    expect((await app.inject({ method: "POST", url: "/v1/hrms/wfh-requests", headers: as(BAND, ["employee"], eNone), payload: { employeeId: eNone, fromDate: "2026-11-02", toDate: "2026-11-02" } })).statusCode).toBe(202);
    const el = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${eM2}`, headers: as(BAND, ["employee"], eM2) });
    expect(el.json()).toMatchObject({ gazetted: true, maxBandRank: 30, bandRank: 40 });
  });

  it("switching the setting back to cpc7 restores the level rule at once", async () => {
    await putPolicy(BAND, "pay_scale", { kind: "cpc7" });
    const f = await feed(BAND);
    expect(Object.keys(f.find((x) => x.id === eC2)!)).not.toContain("gradeBand");
    expect((await postDesig(BAND, { code: "AGAIN", name: "Level forty again", level: 40 })).statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe("isolation: RLS and the composite foreign key", () => {
  it("one tenant never sees another tenant's bands (API and SQL)", async () => {
    const mine = await app.inject({ method: "GET", url: "/v1/hrms/admin/grade-bands", headers: as(GOV) });
    expect((mine.json().data as Array<{ code: string }>).map((b) => b.code)).toEqual(["X1"]);
    const leak = await asTenant(GOV, (tx) => tx`SELECT code FROM employee.hrms_grade_bands WHERE tenant_id = ${BAND}`);
    expect(leak.length).toBe(0);
    await expect(asTenant(GOV, (tx) => tx`INSERT INTO employee.hrms_grade_bands (tenant_id, code, name, rank, created_by, updated_by) VALUES (${BAND}, 'EVIL', 'Cross-tenant write', 1, ${ACTOR}, ${ACTOR})`)).rejects.toThrow();
  });

  it("a designation cannot point at another tenant's band even with a direct write", async () => {
    const bandOfBand = (await asTenant(BAND, (tx) => tx`SELECT id FROM employee.hrms_grade_bands WHERE tenant_id = ${BAND} LIMIT 1`))[0]!.id as string;
    await expect(asTenant(GOV, (tx) => tx`
      INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, grade_band_id, created_by, updated_by)
      VALUES (${randomUUID()}, ${GOV}, 'FKX', 'Cross-tenant link', 0, ${bandOfBand}, ${ACTOR}, ${ACTOR})`)).rejects.toThrow(/foreign key|violates/i);
  });

  it("the database refuses an inverted CTC range, rank 0 and duplicate (tenant, code)", async () => {
    await expect(asTenant(GOV, (tx) => tx`INSERT INTO employee.hrms_grade_bands (tenant_id, code, name, rank, ctc_min_minor, ctc_max_minor, created_by, updated_by) VALUES (${GOV}, 'INV', 'Inverted', 5, 9, 1, ${ACTOR}, ${ACTOR})`)).rejects.toThrow();
    await expect(asTenant(GOV, (tx) => tx`INSERT INTO employee.hrms_grade_bands (tenant_id, code, name, rank, created_by, updated_by) VALUES (${GOV}, 'ZR', 'Rank zero', 0, ${ACTOR}, ${ACTOR})`)).rejects.toThrow();
    await expect(asTenant(GOV, (tx) => tx`INSERT INTO employee.hrms_grade_bands (tenant_id, code, name, rank, created_by, updated_by) VALUES (${GOV}, 'X1', 'Dupe', 5, ${ACTOR}, ${ACTOR})`)).rejects.toThrow();
  });

  it("the same band code can exist in two tenants", async () => {
    const r = await asTenant(GOV, (tx) => tx`INSERT INTO employee.hrms_grade_bands (tenant_id, code, name, rank, created_by, updated_by) VALUES (${GOV}, 'C2', 'Same code, other tenant', 5, ${ACTOR}, ${ACTOR}) RETURNING id`);
    expect(r.length).toBe(1);
  });
});
