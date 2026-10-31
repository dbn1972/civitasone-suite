/**
 * UAT B9-hrms1 -- offer state transitions are status-predicated, real Postgres +
 * the real F3 consumer.
 *
 * Review follow-up to F70 (#2408): every offer write re-read the row inside the
 * consumer transaction and updated it under the optimistic `version` guard, but
 * the version it guarded on was the one it had JUST read, so it never protected
 * against a command whose route-side state check was stale. A duplicate or late
 * SUBMIT processed after the offer was approved reset it to pending_approval at
 * stage 0 (and, by appending a fresh 'submit' event, restarted the SoD cycle);
 * a late expire overwrote an accepted offer. Each transition must now check the
 * expected source status against the locked row in the write transaction and
 * refuse (NonRetryable, audited, no write) when it does not hold.
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
import { COMMANDS } from "../src/topics.js";
import { registerRecruitmentConsumers } from "../src/modules/recruitment/consumer.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { registerRecruitmentFinishConsumers } from "../src/modules/recruitment/finish-consumer.js";
import { seedHrmsCoreFixtures } from "./fixtures/core-seed.js";

registerRecruitmentConsumers(queue);
registerF3_recruitment_Consumers(queue);
registerRecruitmentFinishConsumers(queue);
const mq = queue as unknown as MemoryQueue;
async function drain(): Promise<void> { await mq.drain(); }

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-0000000b9101";
const DEPT = "eeeeeeee-0001-0000-0000-000000000001";
const CT = { "content-type": "application/json" };
const MAKER = "aaaaaaaa-b910-4000-8000-000000000001";
const A = "aaaaaaaa-b910-4000-8000-000000000002";
const B = "aaaaaaaa-b910-4000-8000-000000000003";
const CHAIN = [{ stage: "HR", role: "hr_admin" }, { stage: "Finance", role: "finance_officer" }];
const as = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`, ...CT });
const MAKER_H = () => as(MAKER, ["hr_admin"]);
const A_H = () => as(A, ["hr_admin"]);
const B_H = () => as(B, ["finance_officer"]);
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

const post = (url: string, headers: Record<string, string>, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url, headers, payload });

/** A draft two-level offer created by MAKER (not yet submitted). */
async function draftOffer(): Promise<string> {
  const job = await post("/v1/hrms/job-openings", MAKER_H(),
    { refNo: uniq("B9O"), title: "B9 Offer Guard", departmentId: DEPT, vacancies: 2, isPublished: true });
  expect(job.statusCode, job.body).toBe(202);
  await drain();
  const applied = await post("/v1/careers/apply", CT, { tenantId: TENANT, jobOpeningId: job.json().id, applicantName: "B9 Candidate",
    email: `${uniq("b9o")}@example.gov.in`, mobile: "9876543210", consent: true, consentVersion: "2026-10-v1" });
  expect(applied.statusCode, applied.body).toBe(202);
  await drain();
  const appId = applied.json().id as string;
  const sl = await post(`/v1/hrms/applications/${appId}/screening-decision`, MAKER_H(), { decision: "shortlisted" });
  expect(sl.statusCode, sl.body).toBe(200);
  await drain();
  const created = await post(`/v1/hrms/applications/${appId}/offers`, MAKER_H(), { basicMinor: 5_610_000, approvalChain: CHAIN });
  expect(created.statusCode, created.body).toBe(201);
  await drain();
  return created.json().id as string;
}

/** Drive a draft offer to 'approved' through the real routes (A at L1, B at L2). */
async function approvedOffer(): Promise<string> {
  const offerId = await draftOffer();
  expect((await post(`/v1/hrms/offers/${offerId}/submit`, MAKER_H())).statusCode).toBe(200);
  await drain();
  expect((await post(`/v1/hrms/offers/${offerId}/approve`, A_H())).statusCode).toBe(200);
  await drain();
  expect((await post(`/v1/hrms/offers/${offerId}/approve`, B_H())).statusCode).toBe(200);
  await drain();
  expect(await offerState(offerId)).toMatchObject({ status: "approved", current_stage: 1 });
  return offerId;
}

/** Deliver a submit command exactly as the route publishes it, e.g. a redelivered/late duplicate. */
async function staleSubmit(offerId: string): Promise<void> {
  await queue.publish(COMMANDS.f3RouteWrite, {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: MAKER,
    correlationId: `b9-${randomUUID()}`, schemaVersion: "1.0",
    payload: { op: "recruitment_offer_routes__1", id: randomUUID(), tenantId: TENANT, body: {}, params: { offerId }, query: {} },
  });
  await drain();
}

async function offerState(offerId: string): Promise<{ status: string; current_stage: number }> {
  const [row] = await asTenant((tx) => tx`select status, current_stage from recruitment.hrms_offers where id = ${offerId}`);
  return row as unknown as { status: string; current_stage: number };
}
async function events(offerId: string, action: string): Promise<number> {
  const [r] = await asTenant((tx) => tx`
    select count(*)::int as n from recruitment.hrms_offer_events where offer_id = ${offerId} and action = ${action}`);
  return Number(r!.n);
}
const refusalsFor = (offerId: string) => mq.dlq.filter((d) => JSON.stringify(d.msg.payload).includes(offerId));

describe("UAT B9-hrms1: offer transitions are guarded by the expected source status", () => {
  it("a stale submit processed after approval is refused, not a reset to pending_approval", async () => {
    const offerId = await approvedOffer();
    await staleSubmit(offerId);

    expect(await offerState(offerId)).toMatchObject({ status: "approved", current_stage: 1 });
    // No second 'submit' event: it would have restarted the SoD approval cycle.
    expect(await events(offerId, "submit")).toBe(1);
    const dl = refusalsFor(offerId);
    expect(dl).toHaveLength(1);
    expect(dl[0]!.error).toMatch(/WRONG_STATE/);
  });

  it("a duplicate submit (both requests read 'draft') applies once; the second is refused", async () => {
    const offerId = await draftOffer();
    const s1 = await post(`/v1/hrms/offers/${offerId}/submit`, MAKER_H());
    const s2 = await post(`/v1/hrms/offers/${offerId}/submit`, MAKER_H());
    expect(s1.statusCode, s1.body).toBe(200);
    expect(s2.statusCode, s2.body).toBe(200);
    await drain();
    expect(await offerState(offerId)).toMatchObject({ status: "pending_approval", current_stage: 0 });
    expect(await events(offerId, "submit")).toBe(1);
    expect(refusalsFor(offerId)).toHaveLength(1);

    // ...and the route itself answers 409 once the write has landed.
    const s3 = await post(`/v1/hrms/offers/${offerId}/submit`, MAKER_H());
    expect(s3.statusCode).toBe(409);
    expect(s3.json().code).toBe("WRONG_STATE");
  });

  it("an expire racing an accept on the same 'released' read cannot overwrite the accepted offer", async () => {
    const offerId = await approvedOffer();
    expect((await post(`/v1/hrms/offers/${offerId}/release`, MAKER_H())).statusCode).toBe(200);
    await drain();
    const acc = await post(`/v1/hrms/offers/${offerId}/accept`, MAKER_H());
    const exp = await post(`/v1/hrms/offers/${offerId}/expire`, MAKER_H());
    expect(acc.statusCode, acc.body).toBe(200);
    expect(exp.statusCode, exp.body).toBe(200);
    await drain();
    expect((await offerState(offerId)).status).toBe("accepted");
    expect(await events(offerId, "expire")).toBe(0);
    const dl = refusalsFor(offerId);
    expect(dl).toHaveLength(1);
    expect(dl[0]!.error).toMatch(/WRONG_STATE/);
  });
});
