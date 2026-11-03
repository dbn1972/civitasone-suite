/**
 * UAT J11 / D12: Impose penalty accepted a penalty date (01-01-2026) before the
 * case's charge memo date (03-11-2026) and the case moved to penalty_imposed.
 * The route now refuses it synchronously with 400 PENALTY_BEFORE_CHARGE_MEMO and
 * publishes nothing; a penalty on or after the memo date still goes through.
 * Real route, real DB for the case row; the queue publish is captured.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { hrmsDisciplinaryCases } from "../src/modules/disciplinary/schema.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await sqlClient.end(); });

async function seedCase(proceedingType: "minor" | "major", status: string, chargeMemoDate: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsDisciplinaryCases).values({
    id, tenantId: TENANT, employeeId: randomUUID(), caseNo: `DC-D12-${id.slice(0, 8)}`,
    proceedingType, status, allegation: "D12 regression", chargeMemoDate, chargeMemoRef: "CM/D12",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

async function post(path: string, payload: Record<string, unknown>) {
  const published: unknown[] = [];
  vi.spyOn(infraQueue, "publish").mockImplementation(async (topic: string, msg: unknown) => {
    if (topic === COMMANDS.f3RouteWrite || topic === COMMANDS.disciplinarySubmitApproval) published.push(msg);
  });
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s-d12" }, SECRET);
  const app = await buildApp();
  const r = await app.inject({ method: "POST", url: path, headers: { authorization: `Bearer ${token}` }, payload });
  await app.close();
  return { r, published };
}

describe("penalty date vs charge memo date (UAT J11 / D12)", () => {
  it("refuses a penalty dated before the charge memo, and publishes nothing", async () => {
    const id = await seedCase("minor", "charge_memo_issued", "2026-11-03");
    const { r, published } = await post(`/v1/hrms/disciplinary-cases/${id}/penalty`, { penaltyType: "censure", penaltyDate: "2026-01-01" });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { code: string }).code).toBe("PENALTY_BEFORE_CHARGE_MEMO");
    expect(published).toHaveLength(0);
  });

  it("accepts a penalty on the charge memo date", async () => {
    const id = await seedCase("minor", "charge_memo_issued", "2026-11-03");
    const { r, published } = await post(`/v1/hrms/disciplinary-cases/${id}/penalty`, { penaltyType: "censure", penaltyDate: "2026-11-03" });
    expect(r.statusCode).toBe(200);
    expect(published).toHaveLength(1);
  });

  it("refuses the same back-dated penalty when it is proposed for eOffice approval", async () => {
    const id = await seedCase("major", "finding_recorded", "2026-11-03");
    const { r, published } = await post(`/v1/hrms/disciplinary/${id}/submit-approval`, { penaltyType: "censure", penaltyDate: "2026-10-31" });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { code: string }).code).toBe("PENALTY_BEFORE_CHARGE_MEMO");
    expect(published).toHaveLength(0);
  });
});
