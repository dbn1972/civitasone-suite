/**
 * S8-G4 -- succession planning (GET /v1/hrms/ai/succession) on the band ladder vs the CPC level ladder.
 * Real DB. Two tenants: GOV (pay_scale default cpc7, levels) and BAND (private_bands, every designation level 0).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPolicySettingsConsumers } from "../src/modules/policy-settings/consumer.js";

registerPolicySettingsConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET as string;
const GOV = randomUUID();
const BAND = randomUUID();
const ACTOR = randomUUID();
const DEPT: Record<string, string> = { [GOV]: randomUUID(), [BAND]: randomUUID() };
const as = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["hr_admin"], sid: "sess-succ" }, SECRET)}` });
const asTenant = <T>(tid: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, tid, fn);

let app: Awaited<ReturnType<typeof buildApp>>;
const emp: Record<string, string> = {};

async function seedDesig(tid: string, code: string, level: number, bandId: string | null): Promise<string> {
  const id = randomUUID();
  await asTenant(tid, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, grade_band_id, created_by, updated_by) VALUES (${id}, ${tid}, ${code}, ${"Role " + code}, ${level}, ${bandId}, ${ACTOR}, ${ACTOR})`);
  return id;
}
async function seedEmp(tid: string, key: string, desig: string): Promise<void> {
  const id = randomUUID();
  emp[key] = id;
  await asTenant(tid, (tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
    VALUES (${id}, ${tid}, ${key}, ${key}, ${DEPT[tid]!}, ${desig}, '2015-01-01', 'permanent', ${id}, ${ACTOR}, ${ACTOR})`);
}
async function seedBand(tid: string, code: string, rank: number): Promise<string> {
  const id = randomUUID();
  await asTenant(tid, (tx) => tx`INSERT INTO employee.hrms_grade_bands (id, tenant_id, code, name, rank, created_by, updated_by) VALUES (${id}, ${tid}, ${code}, ${code}, ${rank}, ${ACTOR}, ${ACTOR})`);
  return id;
}
async function cleanup(): Promise<void> {
  for (const tid of [GOV, BAND]) {
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_policy_settings WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_grade_bands WHERE tenant_id = ${tid}`);
    await asTenant(tid, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${tid}`);
  }
}
const succession = async (tid: string, incumbent: string) => {
  const r = await app.inject({ method: "GET", url: `/v1/hrms/ai/succession?positionId=${incumbent}`, headers: as(tid) });
  expect(r.statusCode).toBe(200);
  return (r.json().data as Array<{ employee_no: string; candidate_level: number | null; target_level: number | null }>);
};

beforeAll(async () => {
  await cleanup();
  for (const tid of [GOV, BAND]) {
    await asTenant(tid, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT[tid]!}, ${tid}, 'D', 'Dept', ${ACTOR}, ${ACTOR})`);
  }
  // GOV: incumbent level 8, staff at 7, 6, 5 and 9
  for (const lv of [9, 8, 7, 6, 5]) await seedEmp(GOV, `G${lv}`, await seedDesig(GOV, `L${lv}`, lv, null));
  // BAND: bands with uneven ranks; every designation level 0. Positions by rank order: C2=1, T3=2, M2=3, D1=4
  const b = { C2: await seedBand(BAND, "C2", 20), T3: await seedBand(BAND, "T3", 30), M2: await seedBand(BAND, "M2", 45), D1: await seedBand(BAND, "D1", 90) };
  for (const code of ["C2", "T3", "M2", "D1"] as const) await seedEmp(BAND, `B${code}`, await seedDesig(BAND, code, 0, b[code]));
  await seedEmp(BAND, "BNONE", await seedDesig(BAND, "NOB", 0, null));
  app = await buildApp();
  await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/pay_scale", headers: as(BAND), payload: { kind: "private_bands" } });
  await drain();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("succession on a cpc7 tenant is unchanged", () => {
  it("level 8 incumbent: candidates are exactly levels 6 and 7, with their levels reported", async () => {
    const rows = await succession(GOV, emp.G8!);
    expect(rows.map((r) => r.employee_no).sort()).toEqual(["G6", "G7"]);
    expect(rows.every((r) => r.target_level === 8)).toBe(true);
    expect(rows.map((r) => r.candidate_level).sort()).toEqual([6, 7]);
  });
  it("level 5 is still the floor for a succession target, and level 9 draws from 7 and 8", async () => {
    expect((await succession(GOV, emp.G5!))).toEqual([]);
    expect((await succession(GOV, emp.G9!)).map((r) => r.employee_no).sort()).toEqual(["G7", "G8"]);
  });
});

describe("succession on a private-bands tenant uses the band ladder", () => {
  it("M2 (third band) is succeeded from the two bands below it, T3 and C2, not from the band above or the unbanded", async () => {
    const rows = await succession(BAND, emp.BM2!);
    expect(rows.map((r) => r.employee_no).sort()).toEqual(["BC2", "BT3"]);
    expect(rows.every((r) => r.target_level === 3)).toBe(true);
  });
  it("it does not depend on the rank numbers: D1 (rank 90) draws from M2 and T3, the two nearest bands below", async () => {
    expect((await succession(BAND, emp.BD1!)).map((r) => r.employee_no).sort()).toEqual(["BM2", "BT3"]);
  });
  it("the bottom band has nobody below it, and an unbanded designation neither seeds nor fills a succession", async () => {
    expect(await succession(BAND, emp.BC2!)).toEqual([]);
    expect(await succession(BAND, emp.BNONE!)).toEqual([]);
    expect((await succession(BAND, emp.BT3!)).map((r) => r.employee_no)).toEqual(["BC2"]);
  });
});
