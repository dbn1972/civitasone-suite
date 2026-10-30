/**
 * UAT F70 -- offer approval segregation of duties, real Postgres + the real F3 consumer.
 *
 * Live UAT defect: on a two-level offer chain the maker was correctly refused, but
 * the SAME approver (uxtester2) then cleared level 1 AND level 2, so the offer went
 * to 'approved' with a single checker; a further approve after completion was also
 * accepted. Each level must now be cleared by a distinct person (not the maker, not
 * anyone who already approved an earlier level of the current submission cycle),
 * the chain can never complete with fewer distinct approvers than levels, and an
 * approve on a completed chain is refused.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDbHostPort } from "../../../vitest.testdb";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import type { MemoryQueue } from "@civitasone/queue";
import { registerRecruitmentConsumers } from "../src/modules/recruitment/consumer.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { registerRecruitmentFinishConsumers } from "../src/modules/recruitment/finish-consumer.js";
import { seedHrmsCoreFixtures } from "./fixtures/core-seed.js";

registerRecruitmentConsumers(queue);
registerF3_recruitment_Consumers(queue);
registerRecruitmentFinishConsumers(queue);
async function drain(): Promise<void> { await (queue as unknown as MemoryQueue).drain(); }

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-0000000f7001";
const DEPT = "eeeeeeee-0001-0000-0000-000000000001";
const CT = { "content-type": "application/json" };
const MAKER = "aaaaaaaa-f700-4000-8000-000000000001";
const A = "aaaaaaaa-f700-4000-8000-000000000002"; // holds BOTH stage roles (like uxtester2)
const B = "aaaaaaaa-f700-4000-8000-000000000003";
const C = "aaaaaaaa-f700-4000-8000-000000000004";
const CHAIN = [{ stage: "HR", role: "hr_admin" }, { stage: "Finance", role: "finance_officer" }];
const as = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`, ...CT });
const MAKER_H = () => as(MAKER, ["hr_admin"]);
const A_H = () => as(A, ["hr_admin", "finance_officer"]);
const B_H = () => as(B, ["finance_officer"]);
const C_H = () => as(C, ["finance_officer"]);
const uniq = (l: string) => `${l}-${randomUUID().slice(0, 8)}`;

let app: FastifyInstance;
let db: postgres.Sql;
async function asTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT}', true)`);
    return fn(tx);
  });
}

beforeAll(async () => {
  await seedHrmsCoreFixtures();
  db = postgres(process.env.DATABASE_URL ?? `postgres://hrms_svc:hrms_dev_pw@${testDbHostPort()}/civitas_hrms`, { max: 5 });
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

/** A submitted (pending_approval, stage 0) two-level offer created by MAKER. */
async function submittedOffer(): Promise<string> {
  const job = await app.inject({ method: "POST", url: "/v1/hrms/job-openings", headers: MAKER_H(),
    payload: { refNo: uniq("F70"), title: "F70 Offer SoD", departmentId: DEPT, vacancies: 2, isPublished: true } });
  expect(job.statusCode, job.body).toBe(202);
  await drain();
  const applied = await app.inject({ method: "POST", url: "/v1/careers/apply", headers: CT,
    payload: { tenantId: TENANT, jobOpeningId: job.json().id, applicantName: "F70 Candidate", email: `${uniq("f70")}@example.gov.in`,
      mobile: "9876543210", consent: true, consentVersion: "2026-10-v1" } });
  expect(applied.statusCode, applied.body).toBe(202);
  await drain();
  const appId = applied.json().id as string;
  const sl = await app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/screening-decision`, headers: MAKER_H(), payload: { decision: "shortlisted" } });
  expect(sl.statusCode, sl.body).toBe(200);
  await drain();
  const created = await app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/offers`, headers: MAKER_H(),
    payload: { basicMinor: 5_610_000, approvalChain: CHAIN } });
  expect(created.statusCode, created.body).toBe(201);
  await drain();
  const offerId = created.json().id as string;
  const submit = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/submit`, headers: MAKER_H(), payload: {} });
  expect(submit.statusCode, submit.body).toBe(200);
  await drain();
  return offerId;
}

const approve = (offerId: string, headers: Record<string, string>) =>
  app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/approve`, headers, payload: {} });

async function offerState(offerId: string): Promise<{ status: string; current_stage: number }> {
  const [row] = await asTenant((tx) => tx`select status, current_stage from recruitment.hrms_offers where id = ${offerId}`);
  return row as unknown as { status: string; current_stage: number };
}
async function approvers(offerId: string): Promise<string[]> {
  const rows = await asTenant((tx) => tx`
    select actor_id from recruitment.hrms_offer_events where offer_id = ${offerId} and action = 'approve' order by created_at`);
  return rows.map((r) => String(r.actor_id));
}

describe("UAT F70: two-level offer approval needs two distinct non-maker approvers", () => {
  it("maker refused; A clears L1; A again at L2 refused; B at L2 -> approved; a further approve -> WRONG_STATE", async () => {
    const offerId = await submittedOffer();

    const self = await approve(offerId, MAKER_H());
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("SOD_VIOLATION");

    const l1 = await approve(offerId, A_H());
    expect(l1.statusCode, l1.body).toBe(200);
    await drain();
    expect(await offerState(offerId)).toMatchObject({ status: "pending_approval", current_stage: 1 });

    const again = await approve(offerId, A_H());
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().code).toBe("SOD_VIOLATION");
    await drain();
    expect(await offerState(offerId)).toMatchObject({ status: "pending_approval", current_stage: 1 });
    expect(await approvers(offerId)).toEqual([A]);

    const l2 = await approve(offerId, B_H());
    expect(l2.statusCode, l2.body).toBe(200);
    await drain();
    expect(await offerState(offerId)).toMatchObject({ status: "approved" });
    expect(await approvers(offerId)).toEqual([A, B]);

    // A third approve once the chain is complete is refused, not accepted.
    const third = await approve(offerId, C_H());
    expect(third.statusCode).toBe(409);
    expect(third.json().code).toBe("WRONG_STATE");
    await drain();
    expect(await approvers(offerId)).toEqual([A, B]);
  });

  it("stale read: A's second approve queued before the first is applied cannot clear L2 (consumer re-checks)", async () => {
    const offerId = await submittedOffer();

    // Both requests read the offer at stage 0 with no approvals yet -- exactly the
    // UAT timing (the async write had not landed when the second click arrived).
    const first = await approve(offerId, A_H());
    const second = await approve(offerId, A_H());
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    await drain();

    expect(await offerState(offerId)).toMatchObject({ status: "pending_approval", current_stage: 1 });
    expect(await approvers(offerId)).toEqual([A]);

    const l2 = await approve(offerId, B_H());
    expect(l2.statusCode, l2.body).toBe(200);
    // ...and a third approver racing B on the same stale read is refused by the consumer too.
    const racer = await approve(offerId, C_H());
    expect(racer.statusCode, racer.body).toBe(200);
    await drain();
    expect(await offerState(offerId)).toMatchObject({ status: "approved" });
    expect(await approvers(offerId)).toEqual([A, B]);
  });

  it("a return -> resubmit starts a fresh cycle: the earlier L1 approver may approve L1 again", async () => {
    const offerId = await submittedOffer();
    expect((await approve(offerId, A_H())).statusCode).toBe(200);
    await drain();
    const ret = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/return`, headers: B_H(), payload: { comments: "fix the grade" } });
    expect(ret.statusCode, ret.body).toBe(200);
    await drain();
    const resubmit = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/submit`, headers: MAKER_H(), payload: {} });
    expect(resubmit.statusCode, resubmit.body).toBe(200);
    await drain();

    const l1 = await approve(offerId, A_H());
    expect(l1.statusCode, l1.body).toBe(200);
    await drain();
    expect(await offerState(offerId)).toMatchObject({ status: "pending_approval", current_stage: 1 });
    // ...but still not L2 in the same cycle.
    const again = await approve(offerId, A_H());
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("SOD_VIOLATION");
  });
});
