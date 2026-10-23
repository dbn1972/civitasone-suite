import { describe, it, expect } from "vitest";
import {
  MAX_DELEGATION_DAYS, addDays, daysBetween, delegationState, heldRoleList, isDelegationErrorCode,
  parseDelegationList, parseLegacyReport, validateDelegationForm,
} from "./delegations";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** Exactly what GET /v1/workflow/delegations returns: repo.toView() rows in { data, total } (routes.ts). */
const SERVICE_LIST = {
  data: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tenantId: "tttttttt-tttt-4ttt-8ttt-tttttttttttt",
      delegatorId: ME, delegateId: OTHER, fromDate: "2026-10-01", toDate: "2026-10-31", reason: "Leave",
      roles: ["workflow_user"], isActive: true, createdAt: "2026-09-30T10:00:00.000Z",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tenantId: "tttttttt-tttt-4ttt-8ttt-tttttttttttt",
      delegatorId: ME, delegateId: OTHER, fromDate: "2026-01-01", toDate: null, reason: null,
      roles: [], isActive: false, createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  total: 2,
};

/** Exactly what GET /v1/workflow/delegations/legacy-report returns (routes.ts maps delegatorId -> createdBy). */
const SERVICE_LEGACY = {
  data: [
    { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdBy: ME, delegateId: OTHER, fromDate: "2026-02-01", toDate: null, reason: null, createdAt: "2026-02-01T09:00:00.000Z" },
  ],
  total: 1,
};

describe("parseDelegationList", () => {
  it("parses the real service shape", () => {
    const p = parseDelegationList(SERVICE_LIST)!;
    expect(p.total).toBe(2);
    expect(p.rows[0]).toMatchObject({ delegatorId: ME, delegateId: OTHER, roles: ["workflow_user"], isActive: true, toDate: "2026-10-31" });
    expect(p.rows[1]).toMatchObject({ roles: [], isActive: false, toDate: null, reason: null });
  });
  it("returns null for a body that is not the { data } envelope, and drops malformed rows", () => {
    expect(parseDelegationList(null)).toBeNull();
    expect(parseDelegationList([])).toBeNull();
    expect(parseDelegationList({ rows: [] })).toBeNull();
    expect(parseDelegationList({ data: [{ id: "x" }, "junk"], total: 9 })).toEqual({ rows: [], total: 9 });
  });
});

describe("parseLegacyReport", () => {
  it("parses the real service shape, creator included", () => {
    const p = parseLegacyReport(SERVICE_LEGACY)!;
    expect(p.total).toBe(1);
    expect(p.rows[0]).toMatchObject({ createdBy: ME, delegateId: OTHER, toDate: null });
  });
  it("requires createdBy (a list-shaped row with delegatorId is not a legacy row)", () => {
    expect(parseLegacyReport({ data: [SERVICE_LIST.data[0]] })!.rows).toEqual([]);
    expect(parseLegacyReport("nope")).toBeNull();
  });
});

describe("delegationState", () => {
  const base = { fromDate: "2026-10-01", toDate: "2026-10-31", isActive: true };
  it("classifies by date and the is_active flag, with inclusive bounds", () => {
    expect(delegationState(base, "2026-10-01")).toBe("active");
    expect(delegationState(base, "2026-10-31")).toBe("active");
    expect(delegationState(base, "2026-11-01")).toBe("expired");
    expect(delegationState(base, "2026-09-30")).toBe("upcoming");
    expect(delegationState({ ...base, isActive: false }, "2026-10-15")).toBe("revoked");
    expect(delegationState({ ...base, toDate: null }, "2030-01-01")).toBe("active");
  });
});

describe("date helpers", () => {
  it("daysBetween matches the service (UTC, inclusive span)", () => {
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(daysBetween("2026-10-01", "2026-12-30")).toBe(90);
    expect(daysBetween("2026-10-02", "2026-10-01")).toBe(-1);
  });
  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-10-01", 90)).toBe("2026-12-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("validateDelegationForm", () => {
  const ctx = { heldRoles: ["workflow_user", "estab_officer"], userId: ME };
  const ok = { roles: ["workflow_user"], delegateId: OTHER, fromDate: "2026-10-01", toDate: "2026-10-31", reason: "" };

  it("accepts a valid form", () => expect(validateDelegationForm(ok, ctx)).toEqual({}));
  it("accepts exactly the 90-day cap and rejects 91", () => {
    expect(validateDelegationForm({ ...ok, toDate: "2026-12-30" }, ctx)).toEqual({});
    expect(validateDelegationForm({ ...ok, toDate: "2026-12-31" }, ctx).toDate).toBe("toTooLong");
  });
  it("requires an end date (no open-ended delegation)", () => {
    expect(validateDelegationForm({ ...ok, toDate: "" }, ctx).toDate).toBe("toRequired");
  });
  it("rejects an end before the start, and impossible dates", () => {
    expect(validateDelegationForm({ ...ok, toDate: "2026-09-30" }, ctx).toDate).toBe("toBeforeFrom");
    expect(validateDelegationForm({ ...ok, toDate: "2026-02-30" }, ctx).toDate).toBe("toInvalid");
    expect(validateDelegationForm({ ...ok, fromDate: "2026-13-01" }, ctx).fromDate).toBe("fromInvalid");
    expect(validateDelegationForm({ ...ok, fromDate: "" }, ctx).fromDate).toBe("fromRequired");
  });
  it("requires at least one role, and only roles the user holds", () => {
    expect(validateDelegationForm({ ...ok, roles: [] }, ctx).roles).toBe("rolesRequired");
    expect(validateDelegationForm({ ...ok, roles: ["estab_deputy_secretary"] }, ctx).roles).toBe("roleNotHeld");
    expect(validateDelegationForm({ ...ok, roles: Array.from({ length: 21 }, (_, i) => `r${i}`) }, { ...ctx, heldRoles: Array.from({ length: 21 }, (_, i) => `r${i}`) }).roles).toBe("rolesTooMany");
  });
  it("requires a delegate who is not the user", () => {
    expect(validateDelegationForm({ ...ok, delegateId: null }, ctx).delegate).toBe("delegateRequired");
    expect(validateDelegationForm({ ...ok, delegateId: "not-a-uuid" }, ctx).delegate).toBe("delegateRequired");
    expect(validateDelegationForm({ ...ok, delegateId: ME }, ctx).delegate).toBe("delegateSelf");
  });
  it("caps the reason at 256 characters", () => {
    expect(validateDelegationForm({ ...ok, reason: "x".repeat(256) }, ctx)).toEqual({});
    expect(validateDelegationForm({ ...ok, reason: "x".repeat(257) }, ctx).reason).toBe("reasonTooLong");
  });
  it("uses the same cap as the service constant", () => expect(MAX_DELEGATION_DAYS).toBe(90));
});

describe("misc", () => {
  it("recognises only the three delegation error codes", () => {
    for (const c of ["DELEGATION_ROLE_NOT_HELD", "DELEGATION_TOO_LONG", "DELEGATION_BAD_RANGE"]) expect(isDelegationErrorCode(c)).toBe(true);
    for (const c of ["VALIDATION_FAILED", "NOT_FOUND", undefined, 403]) expect(isDelegationErrorCode(c)).toBe(false);
  });
  it("heldRoleList de-duplicates, sorts and drops non-strings", () => {
    expect(heldRoleList(["b", "a", "b", "", 3, null])).toEqual(["a", "b"]);
  });
});
