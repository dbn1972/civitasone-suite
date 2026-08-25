/**
 * Route-level test: identity/routes.ts never checks visit-request ownership.
 *
 * SECURITY AUDIT FINDING (CRITICAL — cross-actor IDOR, CWE-639). See the
 * companion integration test (identity-verify-ownership.integration.test.ts)
 * for the real-DB proof that the consumer mutates a foreign visit request.
 * This test isolates the ROUTE layer: it proves `POST
 * /v1/visitor/visit-requests/:id/verify-identity` never even attempts to
 * look up the target visit request or compare it to the caller before
 * publishing — unlike, e.g., blacklist/routes.ts's `:id/approve`, which
 * calls `repo.getBlacklistEntryById` first and 404s a foreign/nonexistent
 * id. identity/routes.ts has no equivalent lookup at all.
 *
 * VERIFY_ROLES (identity/routes.ts) explicitly includes "visitor" — by the
 * route's own comment, this is meant for "the visitor themselves (via
 * citizen portal)" to self-verify THEIR OWN visit request. Because there is
 * no ownership check, that same low-privilege role can target ANY
 * visitRequestId in the tenant, not only its own.
 *
 * Follows the minimal-app + mocked-commands convention used throughout this
 * service's route tests (all-routes.test.ts), scoped to just this module's
 * direct dependencies so the mock surface stays small.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";

const TENANT = "11111111-1111-1111-1111-111111111111";
// A visit request belonging to someone else entirely — the calling actor
// below has no relationship to this id (not its creator, host, or visitor).
const FOREIGN_VISIT_REQUEST_ID = "22222222-2222-2222-2222-000000000099";
const ATTACKER_ACTOR = randomUUID();

const digilockerVerifyMock = vi.fn(async (_ctx: unknown, input: { visitRequestId: string }) => ({
  id: input.visitRequestId, status: "accepted", correlationId: "corr-1",
}));
const aadhaarFaceMatchMock = vi.fn(async (_ctx: unknown, input: { visitRequestId: string; confidenceThreshold?: number }) => ({
  id: input.visitRequestId, status: "accepted", correlationId: "corr-1",
}));

vi.mock("../src/modules/identity/commands.js", () => ({
  digilockerVerify: (...args: unknown[]) => digilockerVerifyMock(...(args as [unknown, { visitRequestId: string }])),
  aadhaarFaceMatch: (...args: unknown[]) => aadhaarFaceMatchMock(...(args as [unknown, { visitRequestId: string }])),
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function authHeader(roles: string[], sub = ATTACKER_ACTOR): { authorization: string } {
  const t = signToken({ sub, tid: TENANT, roles, sid: "sess-1" } as never, SECRET);
  return { authorization: `Bearer ${t}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  const { identityRoutes } = await import("../src/modules/identity/routes.js");
  app = Fastify();
  await app.register(identityRoutes);
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe("identity/routes.ts verify-identity — no ownership check (IDOR)", () => {
  it("a 'visitor'-role actor unrelated to the target visit request still gets 202, not 403/404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${FOREIGN_VISIT_REQUEST_ID}/verify-identity`,
      headers: authHeader(["visitor"]),
      payload: { identityMethod: "digilocker", digilockerUri: "https://digilocker.gov/x" },
    });

    // BUG: the route accepts this unconditionally. A correctly-scoped
    // implementation would 403 (not the caller's request) or 404 (caller
    // cannot even confirm existence of a request that is not theirs).
    expect(res.statusCode).toBe(202);
    expect(digilockerVerifyMock).toHaveBeenCalledTimes(1);
    // The route published the command for the FOREIGN id with no
    // ownership predicate applied anywhere in between.
    expect(digilockerVerifyMock.mock.calls[0]?.[1]).toMatchObject({ visitRequestId: FOREIGN_VISIT_REQUEST_ID });
  });

  it("confidenceThreshold is fully caller-controlled with no floor — a 'visitor' role can request threshold=0", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${FOREIGN_VISIT_REQUEST_ID}/verify-identity`,
      headers: authHeader(["visitor"]),
      payload: { identityMethod: "aadhaar_face", aadhaarRef: "ref-1", livePhotoBase64: "ZmFrZQ==", confidenceThreshold: 0 },
    });

    // BUG: zod's aadhaarFaceBody only bounds confidenceThreshold to
    // [0, 100] (identity/routes.ts) — there is no server-side minimum floor
    // and no role gate, so the lowest-privilege caller can trivially force
    // any face-match attempt to pass (matchFace() matches whenever
    // confidence >= confidenceThreshold, and confidence is never negative).
    expect(res.statusCode).toBe(202);
    expect(aadhaarFaceMatchMock).toHaveBeenCalledTimes(1);
    expect(aadhaarFaceMatchMock.mock.calls[0]?.[1]).toMatchObject({ confidenceThreshold: 0 });
  });
});
