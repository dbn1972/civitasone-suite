/**
 * SECURITY/CORRECTNESS regression tests — OTP verify races and challenge
 * selection, on a REAL Postgres (not mocked), because every bug guarded
 * against here is a genuine database race or ordering choice that a mocked
 * db.transaction (as used in otp-verify-route.test.ts) always invokes
 * in-process and so cannot exhibit — or disprove.
 *
 * Three properties under test:
 *
 * 1. Brute-force lockout race (PR #906): for N concurrent wrong-code verify
 *    attempts against one challenge, no more than MAX_ATTEMPTS of them are
 *    ever evaluated as a "real" guess before the lockout gate engages —
 *    regardless of how many fire concurrently. Before that fix, the gate
 *    read `attempts` fresh but incremented it via a DEFERRED async publish,
 *    so concurrent requests could each observe attempts=0 and all be
 *    admitted past the gate.
 *
 * 2. Stale-challenge selection (this PR): otp-request never invalidates a
 *    candidate's prior challenge when it issues a new one — it just inserts
 *    a new row — so requesting a second OTP (e.g. "resend") leaves TWO
 *    non-expired, unverified challenges on file. The public route used to
 *    pick the OLDEST of those (`lockOldestChallenge`), which matched the
 *    STALE code the candidate no longer has, not the fresh one they
 *    actually received — a spurious `OTP_INVALID` on a correct submission.
 *    Fixed by picking the latest, same as the HR route always did.
 *
 * 3. Success-path double-issuance race (this PR): `challenge.verified` used
 *    to flip via a DEFERRED async publish even on the success path, so two
 *    concurrent requests submitting the SAME correct code against the SAME
 *    not-yet-verified challenge could each pass `verifyOtp` (which only
 *    rejects an already-`verified` challenge) and each independently mint a
 *    token/response before either write landed. Fixed by marking verified
 *    synchronously inside the same locked transaction PR #906 introduced —
 *    a second concurrent request now blocks on the lock, then observes
 *    `verified = true` once it acquires it and fails with a normal
 *    `already_verified` 422 instead of also succeeding.
 *
 * Requires DATABASE_URL to point at a migrated hrms-service database
 * (see services/hrms-service/migrations). Run standalone:
 *   DATABASE_URL=postgres://hrms_svc:hrms_dev_pw@localhost:5588/civitas_hrms \
 *     pnpm vitest run tests/otp-lockout-race.integration.test.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient, scopedRead } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import * as candidateRepo from "../src/modules/recruitment/candidate-repo.js";
import * as otpRepo from "../src/modules/recruitment/otp-verify-repo.js";
import { hrmsCandidateOtpChallenges } from "../src/modules/recruitment/candidate-schema.js";
import { eq } from "drizzle-orm";
import { MAX_ATTEMPTS } from "../src/modules/recruitment/otp-verify.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const HR_TENANT = "bbbbbbbb-0ace-4000-8000-0000000000ac";
const HR_USER = "bbbbbbbb-7777-4000-8000-0000000000ac";

process.env.FEATURE_OTP_VERIFICATION_ENABLED = "true";
process.env.NODE_ENV = "test";

registerF3_recruitment_Consumers(queue);
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

const tok = (roles: string[], tenantId: string) => signToken({ sub: HR_USER, tid: tenantId, roles, sid: "s" }, SECRET);
const hrAuth = (tenantId: string) => ({ authorization: `Bearer ${tok(["hr_admin"], tenantId)}` });

afterAll(async () => {
  delete process.env.FEATURE_OTP_VERIFICATION_ENABLED;
  await sqlClient.end();
});

describe("OTP lockout — public careers-portal route (candidate-public-auth-routes.ts)", () => {
  it("admits at most MAX_ATTEMPTS wrong-code guesses per challenge under concurrency", async () => {
    const app = await buildApp();
    const tenantId = randomUUID();
    const email = `race-${randomUUID()}@example.gov.in`;

    // Create the candidate + a fresh OTP challenge (async write — drain before verifying).
    const reqRes = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload: { email, tenantId } });
    await drainF3();
    expect(reqRes.statusCode).toBe(202);
    const { devCode } = reqRes.json() as { devCode: string };

    const CONCURRENCY = 12; // > MAX_ATTEMPTS, to prove the excess gets locked out, not evaluated
    const wrongCode = devCode === "000000" ? "111111" : "000000";

    // Fire all requests genuinely concurrently against the SAME challenge.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        app.inject({ method: "POST", url: "/v1/careers/auth/otp-verify", payload: { email, code: wrongCode, tenantId } })
      )
    );

    const invalid = results.filter((r) => r.statusCode === 422);
    const locked = results.filter((r) => r.statusCode === 429);

    // The key invariant the race used to violate: never more than MAX_ATTEMPTS
    // guesses actually evaluated (422 = code was checked and found wrong).
    expect(invalid.length).toBe(MAX_ATTEMPTS);
    expect(locked.length).toBe(CONCURRENCY - MAX_ATTEMPTS);
    for (const r of locked) expect(r.json().code).toBe("MAX_ATTEMPTS");
    for (const r of invalid) expect(r.json().code).toBe("OTP_INVALID");

    // Now locked out even with the CORRECT code.
    const afterLockout = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-verify", payload: { email, code: devCode, tenantId } });
    expect(afterLockout.statusCode).toBe(429);

    await app.close();
  }, 30_000);

  it("a correct OTP on a fresh challenge still succeeds normally (unaffected by the fix)", async () => {
    const app = await buildApp();
    const tenantId = randomUUID();
    const email = `legit-${randomUUID()}@example.gov.in`;

    const reqRes = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload: { email, tenantId } });
    await drainF3();
    const { devCode, candidateId } = reqRes.json() as { devCode: string; candidateId: string };

    const verifyRes = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-verify", payload: { email, code: devCode, tenantId } });
    expect(verifyRes.statusCode).toBe(200);
    const body = verifyRes.json() as { candidateId: string; token: string };
    expect(body.candidateId).toBe(candidateId);
    expect(typeof body.token).toBe("string");
    await drainF3();
    await app.close();
  }, 30_000);

  it("requesting a second OTP ('resend') lets the candidate verify with the FRESH code, not the stale one (stale-challenge fix)", async () => {
    const app = await buildApp();
    const tenantId = randomUUID();
    const email = `resend-${randomUUID()}@example.gov.in`;

    // First OTP request: challenge A / code A.
    const req1 = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload: { email, tenantId } });
    await drainF3();
    expect(req1.statusCode).toBe(202);
    const { devCode: codeA } = req1.json() as { devCode: string };

    // "Resend": second OTP request for the SAME candidate/channel — the old
    // challenge is NOT invalidated, it just gains a newer sibling row.
    // codeB is virtually certain to differ from codeA (random 6-digit).
    const req2 = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload: { email, tenantId } });
    await drainF3();
    expect(req2.statusCode).toBe(202);
    const { devCode: codeB, candidateId } = req2.json() as { devCode: string; candidateId: string };
    expect(codeB).not.toBe(codeA);

    // The candidate only ever saw codeB (the one actually delivered/echoed
    // by the second request). Before the fix, `lockOldestChallenge` matched
    // this against challenge A's stale codeA and rejected it with a
    // spurious OTP_INVALID, burning an attempt on a genuinely correct code.
    const verifyFresh = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-verify", payload: { email, code: codeB, tenantId } });
    expect(verifyFresh.statusCode).toBe(200);
    const body = verifyFresh.json() as { candidateId: string; token: string };
    expect(body.candidateId).toBe(candidateId);
    expect(typeof body.token).toBe("string");

    await drainF3();
    await app.close();
  }, 30_000);

  it("at most one of several concurrent correct-OTP submissions succeeds; the rest fail with already_verified, not a second token (double-issuance fix)", async () => {
    const app = await buildApp();
    const tenantId = randomUUID();
    const email = `dup-${randomUUID()}@example.gov.in`;

    const reqRes = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload: { email, tenantId } });
    await drainF3();
    expect(reqRes.statusCode).toBe(202);
    const { devCode, candidateId } = reqRes.json() as { devCode: string; candidateId: string };

    const CONCURRENCY = 8;
    // Fire all requests genuinely concurrently, all with the SAME correct
    // code, against the SAME not-yet-verified challenge.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        app.inject({ method: "POST", url: "/v1/careers/auth/otp-verify", payload: { email, code: devCode, tenantId } })
      )
    );

    const succeeded = results.filter((r) => r.statusCode === 200);
    const rejected = results.filter((r) => r.statusCode === 422);

    // The key invariant the race used to violate: never more than ONE
    // concurrent submission of the correct code is treated as a first
    // successful verification (and thus mints a token).
    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(CONCURRENCY - 1);
    const winnerBody = succeeded[0]!.json() as { candidateId: string; token: string };
    expect(winnerBody.candidateId).toBe(candidateId);
    expect(typeof winnerBody.token).toBe("string");
    for (const r of rejected) {
      expect(r.json()).toMatchObject({ code: "OTP_INVALID", message: "already_verified" });
    }

    await app.close();
  }, 30_000);
});

describe("OTP lockout — HR-authenticated route (otp-verify-routes.ts)", () => {
  async function seedCandidateAndChallenge(tenantId: string, code: string): Promise<{ candidateId: string; challengeId: string }> {
    const candidateId = randomUUID();
    const challengeId = randomUUID();
    const email = `hr-race-${randomUUID()}@example.gov.in`;
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await candidateRepo.insertCandidate(tx as never, {
          id: candidateId, tenantId, email, normalizedEmail: email,
          status: "draft", createdBy: HR_USER, updatedBy: HR_USER,
        } as never);
        await otpRepo.insertChallenge(tx as never, {
          id: challengeId, tenantId, candidateId, channel: "email",
          code, expiresAt: new Date(Date.now() + 600_000),
        });
      })
    );
    return { candidateId, challengeId };
  }

  async function readAttempts(tenantId: string, challengeId: string): Promise<number> {
    const rows = await runWithTenant(tenantId, () =>
      scopedRead((tx) => tx.select({ attempts: hrmsCandidateOtpChallenges.attempts })
        .from(hrmsCandidateOtpChallenges).where(eq(hrmsCandidateOtpChallenges.id, challengeId)).limit(1))
    );
    return rows[0]?.attempts ?? -1;
  }

  it("never loses an increment under concurrency (attempts count is exact, not undercounted)", async () => {
    const app = await buildApp();
    const tenantId = randomUUID();
    const { candidateId, challengeId } = await seedCandidateAndChallenge(tenantId, "654321");

    const CONCURRENCY = 9;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        app.inject({ method: "POST", url: `/v1/hrms/candidates/${candidateId}/otp/verify`, headers: hrAuth(tenantId), payload: { code: "000000" } })
      )
    );
    for (const r of results) expect(r.statusCode).toBe(422);

    const finalAttempts = await readAttempts(tenantId, challengeId);
    // Every one of the N concurrent wrong-code requests must be reflected —
    // a lost update here (finalAttempts < CONCURRENCY) is exactly the
    // read-then-write race the old `incrementAttempts` was vulnerable to.
    expect(finalAttempts).toBe(CONCURRENCY);

    await app.close();
  }, 30_000);

  it("a correct OTP on a fresh challenge still succeeds without touching attempts", async () => {
    const app = await buildApp();
    const tenantId = randomUUID();
    const { candidateId, challengeId } = await seedCandidateAndChallenge(tenantId, "222333");

    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${candidateId}/otp/verify`, headers: hrAuth(tenantId), payload: { code: "222333" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ candidateId, verified: true });

    const finalAttempts = await readAttempts(tenantId, challengeId);
    expect(finalAttempts).toBe(0);

    await app.close();
  }, 30_000);

  it("at most one of several concurrent correct-OTP submissions succeeds; the rest fail with already_verified (double-issuance fix)", async () => {
    const app = await buildApp();
    const tenantId = randomUUID();
    const { candidateId, challengeId } = await seedCandidateAndChallenge(tenantId, "778899");

    const CONCURRENCY = 8;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        app.inject({ method: "POST", url: `/v1/hrms/candidates/${candidateId}/otp/verify`, headers: hrAuth(tenantId), payload: { code: "778899" } })
      )
    );

    const succeeded = results.filter((r) => r.statusCode === 200);
    const rejected = results.filter((r) => r.statusCode === 422);

    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(CONCURRENCY - 1);
    expect(succeeded[0]!.json()).toMatchObject({ candidateId, verified: true });
    for (const r of rejected) {
      expect(r.json()).toMatchObject({ code: "OTP_INVALID", message: "already_verified" });
    }

    const finalAttempts = await readAttempts(tenantId, challengeId);
    // The correct-code path must never touch `attempts`, including on the
    // rejected duplicates (they fail on `challenge.verified`, checked before
    // the code comparison — never reach the wrong-code/increment branch).
    expect(finalAttempts).toBe(0);

    await app.close();
  }, 30_000);
});
