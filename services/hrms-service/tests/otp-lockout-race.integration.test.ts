/**
 * SECURITY regression test — OTP brute-force lockout counter race window.
 *
 * Runs against a REAL Postgres (not mocked), because the bug this guards
 * against is a genuine database race: concurrent otp-verify requests against
 * the SAME challenge each reading a stale `attempts` value before an
 * earlier failed attempt's increment had landed. A mocked db.transaction
 * (as used in otp-verify-route.test.ts) always invokes its callback
 * in-process and cannot exhibit — or disprove — a real row-lock race.
 *
 * PROPERTY under test: for N concurrent wrong-code verify attempts against
 * one challenge, no more than MAX_ATTEMPTS of them are ever evaluated as a
 * "real" guess before the lockout gate engages — regardless of how many
 * fire concurrently. Before the fix, the gate read `attempts` fresh but
 * incremented it via a DEFERRED async publish, so concurrent requests could
 * each observe attempts=0 and all be admitted past the gate.
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
});
