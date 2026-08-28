import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RequestContext } from "@civitasone/types";
import { AuthContextError } from "../src/context.js";
import { checkPermission, isSuperAdmin } from "../src/permissions.js";

// ═══════════════════════════════════════════════════════════════════════════
// checkPermission() failure-handling paths (RBAC policy-store fix follow-up).
//
// packages/auth/src/permissions.ts talks to policy-service over plain fetch()
// and can fail three distinct ways, all of which must surface as the SAME
// clean AuthContextError(503, "POLICY_UNAVAILABLE", ...) rather than a raw,
// unhandled error:
//   1. connection-level  — fetch() itself rejects (ECONNREFUSED, DNS, abort)
//   2. HTTP-level        — fetch() resolves but res.ok is false
//   3. malformed-body     — fetch() resolves 200 OK but res.json() can't parse it
// ═══════════════════════════════════════════════════════════════════════════

const ctx: RequestContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  actorId: "00000000-0000-0000-0000-000000000001",
  actorType: "user",
  roles: ["hr_officer"],
  correlationId: "test-correlation-id",
  sessionId: "test-session",
};

async function expectPolicyUnavailable(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AuthContextError);
  try {
    await promise;
    expect.unreachable("expected checkPermission to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(AuthContextError);
    const authErr = err as AuthContextError;
    expect(authErr.status).toBe(503);
    expect(authErr.code).toBe("POLICY_UNAVAILABLE");
  }
}

describe("checkPermission: policy-service failure handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a connection-level fetch failure to a clean 503 POLICY_UNAVAILABLE", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("fetch failed"));
    await expectPolicyUnavailable(checkPermission(ctx, "hrms.leave.approve"));
  });

  it("maps a DNS/abort-style rejection the same way", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("The operation was aborted"));
    await expectPolicyUnavailable(checkPermission(ctx, "hrms.leave.approve"));
  });

  it("companion test — maps an HTTP-level failure (res.ok === false) to the same 503", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    await expectPolicyUnavailable(checkPermission(ctx, "hrms.leave.approve"));
  });

  it("maps a malformed/empty 200 body to the same 503 instead of a raw SyntaxError", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response);
    await expectPolicyUnavailable(checkPermission(ctx, "hrms.leave.approve"));
  });

  it("still returns the decision normally on a healthy 200 response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ decision: "allow", reason: "role:hr_officer+hrms.leave.approve" }),
    } as Response);
    const result = await checkPermission(ctx, "hrms.leave.approve");
    expect(result).toEqual({ decision: "allow", reason: "role:hr_officer+hrms.leave.approve" });
  });

  it("never calls fetch at all for a super_admin actor (fast path)", async () => {
    const superAdminCtx: RequestContext = { ...ctx, roles: ["super_admin"] };
    expect(isSuperAdmin(superAdminCtx)).toBe(true);
    const result = await checkPermission(superAdminCtx, "hrms.leave.approve");
    expect(result).toEqual({ decision: "allow", reason: "role:super_admin" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
