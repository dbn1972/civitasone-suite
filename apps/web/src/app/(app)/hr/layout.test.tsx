import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same mocking convention as lib/auth/roleGuard.test.ts: control the
// session-role JWT claim via the cookies() mock, and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
// ModuleGate itself is an async Server Component (checks tenant module
// enablement) -- irrelevant to this layout's own role gate, and a real
// async component can't be exercised through a synchronous RTL render, so
// stub it down to its children.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => children,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import HrLayout from "./layout";
import { HR_ROLES } from "@/lib/auth/workRoles";

describe("HrLayout", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("admits a plain employee instead of redirecting them away (ESS root-cause fix)", () => {
    // Regression test: HR_ROLES used to omit "employee" entirely, so every
    // self-service code path inside /hr (hr/leave/apply's getMyProfile()
    // fallback, hr/dashboard's own-profile card, hr/payroll's
    // canAdminister-gated view) was unreachable dead code -- a plain
    // employee was redirected to /dashboard before any of it ever ran.
    sessionWithRoles(["employee"]);

    render(<HrLayout>{"hr content"}</HrLayout>);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("hr content")).toBeInTheDocument();
  });

  it("admits a manager", () => {
    sessionWithRoles(["manager"]);
    render(<HrLayout>{"hr content"}</HrLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("still admits hr_admin (unaffected by the widened list)", () => {
    sessionWithRoles(["hr_admin"]);
    render(<HrLayout>{"hr content"}</HrLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("still redirects a role with no HR/ESS relationship at all", () => {
    sessionWithRoles(["citizen"]);
    render(<HrLayout>{"hr content"}</HrLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("still redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<HrLayout>{"hr content"}</HrLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  describe("GAP-HR-SF-09a extraction — every HR_ROLES member, exhaustively", () => {
    // The three tests above predate this refactor and each hardcode one
    // role; they stay as regression anchors. This block is the actual
    // "byte-for-byte behavior-preserving" proof the extraction needs: it
    // reads the real, current HR_ROLES export (the same one hr/layout.tsx
    // now imports) and asserts every single member is admitted -- not a
    // hand-picked sample -- so if HR_ROLES's membership ever drifts from
    // what this layout actually enforces, this fails immediately regardless
    // of which specific role changed.
    it.each(HR_ROLES)("admits a caller whose only role is %s", (role) => {
      sessionWithRoles([role]);
      render(<HrLayout>{"hr content"}</HrLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("HR_ROLES has exactly the 14 roles this layout admits post-GAP-HR-SF-09b + GAP-HR-ICC-06 (no silent addition or removal)", () => {
      // Guards the *set*, independent of the it.each above (which would
      // simply run fewer/different cases if the export shrank or grew --
      // still green, just quietly covering less). Order-independent on
      // purpose: this refactor's contract is set membership, not array
      // order (requireAnyRole only ever calls .some()/.includes() on it).
      //
      // GAP-HR-SF-09b added "admin", "officer", "finance_officer" and
      // "finance_admin" to the original 9 -- see workRoles.ts's own doc
      // comment on HR_ROLES for the full reasoning (resolves
      // GAP-HR-SF09A-001/002/003/011/012/014). "icc_member" is a separate,
      // independently-merged addition (GAP-HR-ICC-06) picked up by this
      // branch's 2026-10-01 rebase onto current main -- not part of
      // GAP-HR-SF-09b's own four, but a real member of current HR_ROLES
      // this set-equality assertion must also account for.
      expect(new Set(HR_ROLES)).toEqual(
        new Set([
          "hr_admin",
          "hr_officer",
          "payroll_officer",
          "payroll_admin",
          "tenant_admin",
          "platform_admin",
          "super_admin",
          "manager",
          "employee",
          "icc_member",
          "admin",
          "officer",
          "finance_officer",
          "finance_admin",
        ]),
      );
    });

    it("admits the four GAP-HR-SF-09b roles explicitly (belt-and-suspenders alongside the it.each above)", () => {
      for (const role of ["admin", "officer", "finance_officer", "finance_admin"]) {
        mockRedirect.mockReset();
        sessionWithRoles([role]);
        const { unmount } = render(<HrLayout>{`hr content ${role}`}</HrLayout>);
        expect(mockRedirect).not.toHaveBeenCalled();
        unmount();
      }
    });

    it("does not admit a role outside HR_ROLES, for every role this exact refactor could plausibly have accidentally let in", () => {
      // Roles from sibling gates (FINANCE_ROLES, PROPOSAL_WRITE_ROLES) and a
      // handful the role-matrix contract test found on specific /hr-hosted
      // backend routes but never in HR_ROLES (see
      // tests/contract/hr-role-matrix.allowlist.json) -- the exact set an
      // import-path mixup or a stray spread in this refactor could have
      // wrongly widened this layout to. "admin"/"officer"/"finance_officer"/
      // "finance_admin" moved OUT of this list and into the admission test
      // above under GAP-HR-SF-09b; "dept_head" (a real keycloak-catalog
      // role -- see workRoles.ts) deliberately stays here: no web page
      // anywhere references it, so widening the layout for it would be a
      // first-time, undocumented grant rather than a reconciled drift.
      // "icc_member" moved OUT of this list on 2026-10-01's rebase onto
      // current main: GAP-HR-ICC-06 (an independent, already-merged PR)
      // added it to HR_ROLES for real, so it now belongs in the admission
      // tests above (it.each(HR_ROLES) already covers it), not here.
      const mustStillReject = [
        "dept_head",
        "audit_officer",
        "budget_officer",
        "security_admin",
      ];
      for (const role of mustStillReject) {
        mockRedirect.mockReset();
        sessionWithRoles([role]);
        const { unmount } = render(<HrLayout>{`hr content ${role}`}</HrLayout>);
        expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
        unmount();
      }
    });
  });
});
