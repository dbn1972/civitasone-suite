/**
 * Route-level test: identity/routes.ts ownership + confidence-floor
 * enforcement (Fix 1 / Fix 2).
 *
 * SECURITY AUDIT FINDINGS, now fixed:
 *   Fix 1 (CRITICAL — cross-actor IDOR, CWE-639): `POST
 *   /v1/visitor/visit-requests/:id/verify-identity` never looked up the
 *   target visit request or compared it to the caller before publishing —
 *   unlike, e.g., blacklist/routes.ts's `:id/approve`, which calls
 *   `repo.getBlacklistEntryById` first and 404s a foreign/nonexistent id.
 *   The route now fetches the visit request (via
 *   visit-request/repo.js#getVisitRequestById) and, for the low-privilege
 *   "visitor" role, requires the caller to be the request's visitor, host,
 *   or original creator (403 otherwise); elevated staff roles
 *   (security_guard/security_admin/tenant_admin/super_admin) are unaffected
 *   — VERIFY_ROLES' own comment documents that guards/admins legitimately
 *   act on visit requests they don't personally own (e.g. operating a
 *   kiosk for whoever is physically present).
 *
 *   Fix 2: `confidenceThreshold` is no longer accepted from the client at
 *   all (previously bounded only to [0, 100], with no floor — any caller
 *   could force a face-match "pass" by submitting 0). The route now always
 *   lets the server-side default (aadhaar-face-adapter.ts's
 *   DEFAULT_CONFIDENCE_THRESHOLD) apply.
 *
 * Follows the minimal-app + mocked-commands convention used throughout this
 * service's route tests (all-routes.test.ts), scoped to just this module's
 * direct dependencies so the mock surface stays small. Adds a mock for
 * visit-request/repo.js#getVisitRequestById (the new Fix 1 dependency).
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";

const TENANT = "11111111-1111-1111-1111-111111111111";
// A visit request belonging to someone else entirely — the ATTACKER_ACTOR
// below has no relationship to this id (not its creator, host, or visitor).
const FOREIGN_VISIT_REQUEST_ID = "22222222-2222-2222-2222-000000000099";
// A visit request that IS associated with ATTACKER_ACTOR (as its visitorId)
// — used to prove a "visitor" caller can still verify THEIR OWN request.
const OWN_VISIT_REQUEST_ID = "22222222-2222-2222-2222-000000000100";
const ATTACKER_ACTOR = randomUUID();
const FOREIGN_VISITOR_ID = randomUUID();
const FOREIGN_HOST_ID = randomUUID();

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

// Fix 1's new dependency: the route looks up the target visit request to
// decide ownership. Mock it with two fixtures — one foreign, one owned by
// ATTACKER_ACTOR — plus a 404 case for anything else.
const getVisitRequestByIdMock = vi.fn(async (_tenantId: string, id: string) => {
  if (id === FOREIGN_VISIT_REQUEST_ID) {
    return { id, visitorId: FOREIGN_VISITOR_ID, hostEmployeeId: FOREIGN_HOST_ID, createdBy: FOREIGN_HOST_ID };
  }
  if (id === OWN_VISIT_REQUEST_ID) {
    return { id, visitorId: ATTACKER_ACTOR, hostEmployeeId: randomUUID(), createdBy: randomUUID() };
  }
  return null;
});
vi.mock("../src/modules/visit-request/repo.js", () => ({
  getVisitRequestById: (...args: unknown[]) => getVisitRequestByIdMock(...(args as [string, string])),
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
beforeEach(() => {
  digilockerVerifyMock.mockClear();
  aadhaarFaceMatchMock.mockClear();
  getVisitRequestByIdMock.mockClear();
});

describe("identity/routes.ts verify-identity — ownership (Fix 1) and confidence floor (Fix 2)", () => {
  it("a 'visitor'-role actor unrelated to the target visit request gets 403, not 202", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${FOREIGN_VISIT_REQUEST_ID}/verify-identity`,
      headers: authHeader(["visitor"]),
      payload: { identityMethod: "digilocker", digilockerUri: "https://digilocker.gov/x" },
    });

    expect(res.statusCode).toBe(403);
    expect(digilockerVerifyMock).not.toHaveBeenCalled();
  });

  it("a 'visitor'-role actor verifying THEIR OWN visit request still gets 202", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${OWN_VISIT_REQUEST_ID}/verify-identity`,
      headers: authHeader(["visitor"]),
      payload: { identityMethod: "digilocker", digilockerUri: "https://digilocker.gov/x" },
    });

    expect(res.statusCode).toBe(202);
    expect(digilockerVerifyMock).toHaveBeenCalledTimes(1);
    expect(digilockerVerifyMock.mock.calls[0]?.[1]).toMatchObject({ visitRequestId: OWN_VISIT_REQUEST_ID });
  });

  it("an elevated role (security_guard) can verify identity on a visit request it has no ownership relationship to", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${FOREIGN_VISIT_REQUEST_ID}/verify-identity`,
      headers: authHeader(["security_guard"]),
      payload: { identityMethod: "digilocker", digilockerUri: "https://digilocker.gov/x" },
    });

    expect(res.statusCode).toBe(202);
    expect(digilockerVerifyMock).toHaveBeenCalledTimes(1);
  });

  it("a visit request that does not exist 404s regardless of role", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${randomUUID()}/verify-identity`,
      headers: authHeader(["security_admin"]),
      payload: { identityMethod: "digilocker", digilockerUri: "https://digilocker.gov/x" },
    });

    expect(res.statusCode).toBe(404);
    expect(digilockerVerifyMock).not.toHaveBeenCalled();
  });

  it("confidenceThreshold is no longer accepted from the client — the server-side default is always used", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${OWN_VISIT_REQUEST_ID}/verify-identity`,
      headers: authHeader(["visitor"]),
      payload: { identityMethod: "aadhaar_face", aadhaarRef: "ref-1", livePhotoBase64: "ZmFrZQ==", confidenceThreshold: 0 },
    });

    // The client-supplied confidenceThreshold=0 is stripped at the zod
    // boundary (aadhaarFaceBody no longer defines this field) and never
    // reaches the command — matchFace() can no longer be forced to "pass"
    // at any confidence.
    expect(res.statusCode).toBe(202);
    expect(aadhaarFaceMatchMock).toHaveBeenCalledTimes(1);
    expect(aadhaarFaceMatchMock.mock.calls[0]?.[1]).not.toHaveProperty("confidenceThreshold");
  });
});
