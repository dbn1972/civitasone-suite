/**
 * SEC-003 — the cand_token's `tenantId` claim must be bound to the tenant
 * the OTP challenge was actually locked/verified under (server state), not
 * echoed back from the client-supplied `tenantId` in the request body.
 *
 * candidate-public-auth-routes.ts's otp-verify handler uses the request's
 * OWN tenantId to establish the ambient RLS tenant context AND to filter
 * `otpRepo.lockLatestChallenge`'s WHERE clause -- so in a real deployment a
 * challenge row can only ever be found under the tenant it actually belongs
 * to. This test proves the CODE PATH itself derives the signed token's
 * tenantId from the challenge row `lockLatestChallenge` returns (server
 * state), not from the closure variable that came from `req.body.tenantId`
 * -- so a future change to that query (or a bug in the RLS/WHERE-clause
 * enforcement it depends on) cannot silently start signing an
 * attacker-chosen tenantId into a trusted token again. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-003.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Declared inside vi.hoisted() (not as plain top-level consts) because
// vi.mock() factories below are hoisted above normal const declarations --
// referencing an ordinary const from inside a vi.mock factory throws a TDZ
// ReferenceError. See https://vitest.dev/api/vi.html#vi-mock.
const IDS = vi.hoisted(() => ({
  CANDIDATE_ID: "dddddddd-0003-4000-8000-00000000d003",
  REQUEST_TENANT: "aaaaaaaa-0003-4000-8000-000000000003", // client-supplied
  CHALLENGE_TENANT: "bbbbbbbb-9999-4000-8000-000000000009", // server-state, on the locked row
  EMAIL: "candidate@example.gov.in",
  CODE: "123456",
}));
const { CANDIDATE_ID, REQUEST_TENANT, CHALLENGE_TENANT, EMAIL, CODE } = IDS;

const H = vi.hoisted(() => ({
  lockLatestChallenge: vi.fn(),
  incrementAttempts: vi.fn(),
  markVerified: vi.fn(),
}));

// The route reads/writes hrms_candidates directly via drizzle
// (tx.select({...}).from(hrmsCandidates).where(...).limit(1)), inside
// scopedRead()/scopedWriteForTenant() -> scopedRead(). Note: scopedRead()'s
// REAL implementation (shared/db.ts) calls db.transaction() using db.ts's
// OWN internal binding, not the re-exported `db` -- so overriding just the
// `db` export here would NOT affect scopedRead() at all (its closure never
// sees this mock). scopedRead itself must be overridden directly so that
// candidate-public-auth-routes.ts's own `import { scopedRead } from
// "../../shared/db.js"` picks up the stub.
vi.mock("../src/shared/db.js", async (io) => {
  const candidateRow = { id: IDS.CANDIDATE_ID, fullName: "Test Candidate" };
  const stubTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [candidateRow],
        }),
      }),
    }),
  };
  return {
    ...(await io<Record<string, unknown>>()),
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(stubTx) },
    scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn(stubTx),
  };
});

vi.mock("../src/modules/recruitment/otp-verify-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  // Row belongs to CHALLENGE_TENANT -- the server's own record of which
  // tenant this OTP challenge was issued/locked under -- deliberately
  // DIFFERENT from REQUEST_TENANT, the value the client puts in the request
  // body. A real deployment's WHERE tenant_id = :tenantId (plus FORCE RLS)
  // means these two would always coincide when a row is actually found;
  // this mock decouples them on purpose to prove which one the signing code
  // path actually uses.
  lockLatestChallenge: (...a: unknown[]) => H.lockLatestChallenge(...a),
  incrementAttempts: (...a: unknown[]) => H.incrementAttempts(...a),
  markVerified: (...a: unknown[]) => H.markVerified(...a),
}));

import { buildApp } from "../src/app.js";
import { verifyCandToken } from "../src/modules/recruitment/candidate-public-auth-routes.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = "test";
  H.lockLatestChallenge.mockResolvedValue({
    id: "ch-1",
    tenantId: CHALLENGE_TENANT,
    code: CODE,
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
    verified: false,
  });
  H.incrementAttempts.mockResolvedValue(1);
  H.markVerified.mockResolvedValue(undefined);
});
afterAll(() => { delete process.env.NODE_ENV; });

describe("SEC-003 — otp-verify signs the token with the challenge row's own tenantId", () => {
  it("uses the locked challenge row's tenantId, not the request body's tenantId, in the issued cand_token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/careers/auth/otp-verify",
      payload: { email: EMAIL, code: CODE, tenantId: REQUEST_TENANT },
    });

    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    const claims = verifyCandToken(token);

    expect(claims).not.toBeNull();
    // The regression this guards: before the fix this asserted
    // REQUEST_TENANT (the code re-emitted the closure variable sourced from
    // req.body.tenantId). It must now be CHALLENGE_TENANT -- the tenantId
    // column read back off the DB row lockLatestChallenge returned.
    expect(claims!.tenantId).toBe(CHALLENGE_TENANT);
    expect(claims!.tenantId).not.toBe(REQUEST_TENANT);
    expect(claims!.candidateId).toBe(CANDIDATE_ID);
    expect(claims!.email).toBe(EMAIL);

    await app.close();
  });
});
