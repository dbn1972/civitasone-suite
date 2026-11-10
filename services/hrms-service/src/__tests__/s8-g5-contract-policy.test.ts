/**
 * S8 G5 -- pure rules: contract projection pick, lapse policy, alert routing, weekly digest.
 * No database; the DB-backed behaviour is in s8-g5-contract-projection-real-db.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  pickProjectionContract, buildProjection, projectFromTerms, sameProjection, EMPTY_PROJECTION,
} from "../modules/contracts/projection.js";
import {
  resolveLapsePolicy, resolveNotifyRoles, flagOnlyDue, routeRecipients, buildDigest, isDigestDay,
  LAPSE_FLAGGED_MARK, GRACE_ELAPSED_MARK,
} from "../modules/contracts/policy.js";

const PROJECT = "4b7f0b52-6a54-4d0e-9a53-0d1f5f0c7a11";
const c = (id: string, status: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
  ({ id, status, startDate: start, endDate: end, renewalCount: 0, terms: {}, ...extra });

describe("pickProjectionContract", () => {
  it("prefers an in-force contract over a later-ending past one, and the latest end among in-force", () => {
    const rows = [c("old", "renewed", "2025-04-01", "2026-03-31"), c("cur", "active", "2026-04-01", "2027-03-31"), c("exp", "escalated", "2026-01-01", "2026-12-31")];
    expect(pickProjectionContract(rows)!.id).toBe("cur");
  });
  it("a draft renewal never represents the employee; the superseded contract still does until the draft is activated", () => {
    expect(pickProjectionContract([c("old", "renewed", "2025-04-01", "2026-03-31"), c("next", "draft", "2026-03-31", "2027-03-31")])!.id).toBe("old");
  });
  it("falls back to the most recent expired / terminated record, and to null when only drafts exist", () => {
    expect(pickProjectionContract([c("a", "expired", "2024-01-01", "2024-12-31"), c("b", "terminated", "2025-01-01", "2025-06-30")])!.id).toBe("b");
    expect(pickProjectionContract([c("d", "draft", "2026-01-01", "2026-12-31")])).toBeNull();
    expect(pickProjectionContract([])).toBeNull();
  });
});

describe("projection shape", () => {
  it("copies dates, status, renewal count and the project reference from terms", () => {
    const p = buildProjection(c("k1", "active", "2026-04-01", "2027-03-31", {
      renewalCount: 2, terms: { role: "Project Analyst", projectId: PROJECT.toUpperCase(), projectCode: "NIC-EGOV-014", projectName: "National e-Governance Gateway" },
    }));
    expect(p).toEqual({
      contractId: "k1", contractStartDate: "2026-04-01", contractEndDate: "2027-03-31", contractStatus: "active",
      contractRenewalCount: 2, primaryProjectId: PROJECT, projectCode: "NIC-EGOV-014", projectName: "National e-Governance Gateway",
    });
  });
  it("older contracts with no project in terms project to null project fields; a bad project id is ignored, not stored", () => {
    expect(projectFromTerms({ role: "Analyst" })).toEqual({ projectId: null, projectCode: null, projectName: null });
    expect(projectFromTerms({ projectId: "not-a-uuid", projectCode: "  " }).projectId).toBeNull();
    expect(projectFromTerms(null).projectCode).toBeNull();
  });
  it("no contract projects to all-null, and sameProjection compares field by field", () => {
    expect(buildProjection(null)).toEqual(EMPTY_PROJECTION);
    expect(sameProjection(EMPTY_PROJECTION, { ...EMPTY_PROJECTION })).toBe(true);
    expect(sameProjection(EMPTY_PROJECTION, { ...EMPTY_PROJECTION, projectCode: "X" })).toBe(false);
  });
});

describe("lapse policy (owner question 7 undecided: default stays auto_separate)", () => {
  it("defaults to auto_separate with no grace when there is no config, or an unknown value", () => {
    expect(resolveLapsePolicy(null)).toEqual({ action: "auto_separate", graceDays: 0 });
    expect(resolveLapsePolicy({})).toEqual({ action: "auto_separate", graceDays: 0 });
    expect(resolveLapsePolicy({ lapseAction: "delete_everything", graceDays: 9999 })).toEqual({ action: "auto_separate", graceDays: 0 });
  });
  it("reads flag_only with its grace days", () => {
    expect(resolveLapsePolicy({ lapseAction: "flag_only", graceDays: 15 })).toEqual({ action: "flag_only", graceDays: 15 });
  });
  it("flag_only markers: flag on the lapse day; escalation once grace has passed; nothing before the end date", () => {
    expect(flagOnlyDue(-1, 7)).toEqual([]);
    expect(flagOnlyDue(0, 7)).toEqual([LAPSE_FLAGGED_MARK]);
    expect(flagOnlyDue(6, 7)).toEqual([LAPSE_FLAGGED_MARK]);
    expect(flagOnlyDue(7, 7)).toEqual([LAPSE_FLAGGED_MARK, GRACE_ELAPSED_MARK]);
    expect(flagOnlyDue(0, 0)).toEqual([LAPSE_FLAGGED_MARK, GRACE_ELAPSED_MARK]);
  });
});

describe("alert routing", () => {
  const emp = { managerId: "11111111-1111-4111-8111-111111111111", projectManagerId: "22222222-2222-4222-8222-222222222222" };
  const me = "33333333-3333-4333-8333-333333333333";
  it("no notify roles: the employee only (the pre-G5 routing)", () => {
    expect(routeRecipients(emp, me, [])).toEqual([me]);
    expect(resolveNotifyRoles({})).toEqual([]);
    expect(resolveNotifyRoles({ notifyRoles: "project_manager" })).toEqual([]);
  });
  it("adds the project manager and/or line manager, de-duplicated, ignoring unknown roles", () => {
    expect(routeRecipients(emp, me, ["project_manager"])).toEqual([me, emp.projectManagerId]);
    expect(routeRecipients(emp, me, ["project_manager", "line_manager"])).toEqual([me, emp.projectManagerId, emp.managerId]);
    expect(routeRecipients({ managerId: emp.projectManagerId, projectManagerId: emp.projectManagerId }, me, ["project_manager", "line_manager"])).toHaveLength(2);
    expect(resolveNotifyRoles({ notifyRoles: ["line_manager", "ceo", "project_manager"] })).toEqual(["project_manager", "line_manager"]);
  });
  it("a missing employee row or an unset manager never throws", () => {
    expect(routeRecipients(null, me, ["project_manager"])).toEqual([me]);
    expect(routeRecipients({ managerId: null, projectManagerId: null }, me, ["project_manager", "line_manager"])).toEqual([me]);
  });
});

describe("weekly HR digest", () => {
  it("counts contracts ending within 30 days and those with no renewal request", () => {
    const rows = [
      { endDate: "2026-11-20", hasRenewalRequest: true },
      { endDate: "2026-11-30", hasRenewalRequest: false },
      { endDate: "2026-12-10", hasRenewalRequest: false }, // exactly 30 days out: included
      { endDate: "2026-12-11", hasRenewalRequest: false }, // 31 days: not
      { endDate: "2026-11-09", hasRenewalRequest: false }, // already past: not
    ];
    expect(buildDigest(rows, "2026-11-10")).toEqual({ endingSoon: 3, withoutRenewal: 2 });
    expect(buildDigest([], "2026-11-10")).toEqual({ endingSoon: 0, withoutRenewal: 0 });
  });
  it("goes out on Mondays only", () => {
    expect(isDigestDay("2026-11-09")).toBe(true);  // Monday
    expect(isDigestDay("2026-11-10")).toBe(false); // Tuesday
  });
});
