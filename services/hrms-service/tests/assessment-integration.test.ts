/**
 * Assessment & Certification — integration tests (SVC-123).
 * Exercises maker-checker on publish, attempt-limit enforcement, grading,
 * certificate issuance (only on pass, exactly once / idempotent), verify, and
 * the transactional-outbox emission — all through the real Fastify app.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { tenantStorage } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { registerF3_assessment_Consumers } from "../src/modules/assessment/f3-consumer.js";
import * as repo from "../src/modules/assessment/repo.js";

// Question-bank creation, question creation, and assessment creation all now
// write via publishF3Write + an async F3 consumer (CQRS) instead of
// mutating synchronously. Only worker.ts wires consumers + the tenant-aware
// subscribe wrapper in production, so tests must do both themselves — see
// tests/agent1-gap-routes.test.ts for the established pattern.
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
wireTenantAwareQueue(queue);
registerF3_assessment_Consumers(queue);
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-0000-4000-8000-000000000123";
const MAKER  = "cccccccc-0000-4000-8000-00000000aaaa";
const CHECKER = "cccccccc-0000-4000-8000-00000000bbbb";
const EMP_PASS = "cccccccc-0000-4000-8000-00000000e001";
const EMP_FAIL = "cccccccc-0000-4000-8000-00000000e002";

function tok(actor: string) {
  return signToken({ sub: actor, tid: TENANT, roles: ["super_admin", "hr_admin"], sid: "s" }, SECRET, 3600);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const bare = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;
let bankId: string;
let q1: string;
let q2: string;
let assessmentId: string;
let attemptId: string;
let verifyToken: string;

beforeAll(async () => {
  app = await buildApp();

  // maker creates the question bank
  let res = await app.inject({ method: "POST", url: "/v1/hrms/assessment/question-banks",
    headers: auth(tok(MAKER)), payload: { title: "Fire Safety", competencyRef: "COMP-FIRE" } });
  expect(res.statusCode).toBe(201);
  bankId = res.json().id;
  await drainF3();

  // checker (≠ bank creator) adds two single-choice questions, 5 marks each
  for (const _ of [1, 2]) {
    res = await app.inject({ method: "POST", url: `/v1/hrms/assessment/question-banks/${bankId}/questions`,
      headers: auth(tok(CHECKER)),
      payload: { qtype: "single", stem: "2+2?", options: [{ id: "a", text: "4" }, { id: "b", text: "5" }], correct: ["a"], marks: 5 } });
    expect(res.statusCode).toBe(201);
  }
  await drainF3();
  const qs = (await app.inject({ method: "GET", url: `/v1/hrms/assessment/question-banks/${bankId}/questions`,
    headers: auth(tok(MAKER)) })).json();
  q1 = qs[0].id; q2 = qs[1].id;

  // maker creates the assessment (passing 10 = both correct), then submits for approval
  res = await app.inject({ method: "POST", url: "/v1/hrms/assessments", headers: auth(tok(MAKER)),
    payload: { title: "Fire Safety Test", bankId, passingScore: 10, durationMins: 30, maxAttempts: 1, validityMonths: 12 } });
  expect(res.statusCode).toBe(201);
  assessmentId = res.json().id;
  await drainF3();

  res = await app.inject({ method: "POST", url: `/v1/hrms/assessments/${assessmentId}/submit-for-approval`, headers: bare(tok(MAKER)) });
  expect(res.statusCode).toBe(200);
  await drainF3();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("maker-checker on publish", () => {
  it("rejects publish by the creator (maker == checker)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/assessments/${assessmentId}/publish`, headers: bare(tok(MAKER)) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });

  it("allows publish by a different checker", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/assessments/${assessmentId}/publish`, headers: bare(tok(CHECKER)) });
    expect(res.statusCode).toBe(200);
    // publish writes via publishF3Write + the async F3 consumer (CQRS): the
    // route's synchronous pre-check (see assessment/routes.ts __5) already
    // guarantees pending_approval → published is the only transition that
    // can happen here, so the route now reports the real, deterministic
    // "published" status directly, not the old publishF3Write placeholder's
    // generic "accepted". The actual row update still only happens once the
    // queued write is consumed — drain before any later test relies on the
    // assessment actually being published (attempts, certificates, etc.),
    // and do it in `finally` so a future assertion failure on this line
    // can't skip the drain and cascade into every test after it.
    try {
      expect(res.json().status).toBe("published");
    } finally {
      await drainF3();
    }
  });

  it("rejects a question-bank change by the bank creator (maker == checker)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/assessment/question-banks/${bankId}/questions`,
      headers: auth(tok(MAKER)),
      payload: { qtype: "single", stem: "x?", options: [{ id: "a", text: "y" }], correct: ["a"], marks: 1 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });
});

describe("attempt + certificate issuance", () => {
  it("passes, issues a certificate exactly once, and writes an outbox event", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/assessments/${assessmentId}/attempts`,
      headers: auth(tok(MAKER)), payload: { employeeId: EMP_PASS } });
    expect(res.statusCode).toBe(201);
    attemptId = res.json().id;
    // "start attempt" writes via publishF3Write + the async F3 consumer too
    // (assessment_routes__7) — the row this test's `submit` call needs to
    // find via repo.getAttempt() below doesn't exist until this drains.
    await drainF3();

    res = await app.inject({ method: "POST", url: `/v1/hrms/attempts/${attemptId}/submit`, headers: auth(tok(MAKER)),
      payload: { answers: [{ questionId: q1, response: ["a"] }, { questionId: q2, response: ["a"] }] } });
    // Drain BEFORE asserting: grading, answer storage, and certificate
    // issuance all happen in the async consumer (f3-consumer.ts,
    // assessment_routes__8), so later tests in this describe block need
    // that write applied regardless of what the assertions below find.
    await drainF3();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // KNOWN GAP (not fixed here — see PR description): assessment/routes.ts
    // submit-attempt (~line 180-182) still builds its response from
    // `result.score` / `result.passed` / `result.certificate`, where `result`
    // is whatever publishF3Write() returns — always the hard-coded
    // `{ id, status: "accepted", correlationId }` placeholder (see
    // shared/f3-publish.ts). None of those three fields exist on it, so the
    // HTTP response NEVER carries the graded score, pass/fail, or issued
    // certificate to the caller, even though the async consumer (above)
    // computes and persists all three correctly in the database a moment
    // later. This is a real response-shaping bug in the route, not a stale
    // test assertion — a client polling for its own submit result over HTTP
    // has no way to get it. Left failing and documented rather than papered
    // over; downstream tests below read the persisted state via `repo`
    // instead of trusting this response, so they still exercise real behavior.
    expect(body.score).toBe(10);
    expect(body.passed).toBe(true);
    expect(body.certificate).toBeTruthy();

    // outbox row present for this tenant (read inside tenant GUC context)
    tenantStorage.enterWith({ tenantId: TENANT });
    // NOTE: this service stores outbox payloads as a JSON-string scalar in the
    // jsonb column (service-wide convention), so unwrap with #>>'{}' then re-cast.
    const outboxRows = await db.transaction((tx) =>
      tx.execute(sql`select event_type,
                            (payload #>> '{}')::jsonb ->> 'employee_id'    as employee_id,
                            (payload #>> '{}')::jsonb ->> 'assessment_id'  as assessment_id,
                            (payload #>> '{}')::jsonb ->> 'competency_ref' as competency_ref
                       from _outbox.messages
                      where topic = 'assessment.certificate.issued'
                        and tenant_id = ${TENANT}::uuid
                        and (payload #>> '{}')::jsonb ->> 'assessment_id' = ${assessmentId}`));
    expect(outboxRows.length).toBe(1);
    const row = outboxRows[0] as Record<string, unknown>;
    expect(row.event_type).toBe("assessment.certificate.issued");
    expect(row.employee_id).toBe(EMP_PASS);
    expect(row.assessment_id).toBe(assessmentId);
    expect(row.competency_ref).toBe("COMP-FIRE");
  });

  it("issuance is idempotent — a second insert for the same attempt is a no-op", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    const dup = await db.transaction((tx) => repo.insertCertificate(tx, {
      tenantId: TENANT, assessmentId, attemptId, employeeId: EMP_PASS,
      certificateNo: "CERT-DUP-0001", verifyToken: "dup0000000000000000000000000000",
    }));
    expect(dup).toBeNull(); // UNIQUE(attempt_id) → onConflictDoNothing
    const cert = await repo.getCertificateByAttempt(TENANT, attemptId);
    expect(cert).toBeTruthy();
    expect(cert!.certificateNo).not.toBe("CERT-DUP-0001"); // original preserved
  });

  it("blocks a second attempt once max_attempts is exhausted", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/assessments/${assessmentId}/attempts`,
      headers: auth(tok(MAKER)), payload: { employeeId: EMP_PASS } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ATTEMPT_LIMIT");
  });

  it("does NOT issue a certificate on a failing attempt", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/assessments/${assessmentId}/attempts`,
      headers: auth(tok(MAKER)), payload: { employeeId: EMP_FAIL } });
    expect(res.statusCode).toBe(201);
    const failAttempt = res.json().id;
    await drainF3(); // see drainF3() note on the attempt-creation call above
    res = await app.inject({ method: "POST", url: `/v1/hrms/attempts/${failAttempt}/submit`, headers: auth(tok(MAKER)),
      payload: { answers: [{ questionId: q1, response: ["b"] }, { questionId: q2, response: ["b"] }] } });
    await drainF3();
    expect(res.statusCode).toBe(200);
    // Same KNOWN GAP as the passing-attempt test above: `passed`/`certificate`
    // are never populated on this response (publishF3Write's placeholder has
    // neither field). Left failing and documented; the DB-level assertions
    // below (via `repo`, not the response body) still confirm the consumer
    // did the right thing — no certificate row for a failed attempt.
    expect(res.json().passed).toBe(false);
    expect(res.json().certificate).toBeNull();
    tenantStorage.enterWith({ tenantId: TENANT });
    const cert = await repo.getCertificateByAttempt(TENANT, failAttempt);
    expect(cert).toBeUndefined();
  });

  it("verify endpoint returns active status for the issued certificate", async () => {
    // verifyToken can't come from the submit response (see KNOWN GAP above --
    // it's never populated there); read the certificate the consumer actually
    // persisted for the passing attempt instead.
    tenantStorage.enterWith({ tenantId: TENANT });
    const issuedCert = await repo.getCertificateByAttempt(TENANT, attemptId);
    verifyToken = issuedCert!.verifyToken;
    const res = await app.inject({ method: "GET", url: `/v1/hrms/assessment/certificates/verify/${verifyToken}`,
      headers: bare(tok(CHECKER)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("active");
    expect(res.json().employeeId).toBe(EMP_PASS);
  });
});
