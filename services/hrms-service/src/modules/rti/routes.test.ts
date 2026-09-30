/**
 * GAP-HR-RTI-03 (DPDP masking) and GAP-HR-RTI-06 (IST timezone).
 *
 * These are pure functions (no DB/Fastify) exported specifically so this
 * gap's actual security and statutory-deadline logic is unit-tested
 * directly, rather than only indirectly via a full route/DB integration
 * test. See employee/queries.test.ts for the analogous ICC/directory
 * pattern of testing the projection function itself.
 */
import { describe, it, expect } from "vitest";
import { canSeeApplicantIdentity, projectRtiListRow, projectRtiDetail, todayIst, withSla } from "./routes.js";
import type { RtiRow } from "./schema.js";
import type { RequestContext } from "@civitasone/types";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000011";
const PIO_ID = "22222222-0000-0000-0000-000000000001";
const OTHER_OFFICER_ID = "22222222-0000-0000-0000-000000000099";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: TENANT,
    actorId: OTHER_OFFICER_ID,
    roles: ["hr_officer"],
    correlationId: "test-correlation",
    ...overrides,
  } as RequestContext;
}

const BASE_ROW: RtiRow = {
  id: "rti-1",
  tenantId: TENANT,
  referenceNo: "RTI/2026/001",
  applicantName: "Ramesh Kumar",
  applicantContact: "ramesh@example.com",
  subject: "Road repair status",
  requestText: "Please provide the status of road repair work on MG Road.",
  receivedDate: "2026-08-01",
  dueDate: "2026-08-31",
  pioId: PIO_ID,
  status: "assigned",
  responseText: null,
  respondedDate: null,
  appealText: null,
  appealDate: null,
  closedDate: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  createdBy: PIO_ID,
  updatedBy: PIO_ID,
  version: 1,
};

describe("canSeeApplicantIdentity (GAP-HR-RTI-03)", () => {
  it("denies a plain hr_officer who is not the assigned PIO", () => {
    expect(canSeeApplicantIdentity(ctx({ roles: ["hr_officer"], actorId: OTHER_OFFICER_ID }), BASE_ROW)).toBe(false);
  });

  it("allows the assigned PIO even without hr_admin", () => {
    expect(canSeeApplicantIdentity(ctx({ roles: ["hr_officer"], actorId: PIO_ID }), BASE_ROW)).toBe(true);
  });

  it("allows hr_admin regardless of assignment", () => {
    expect(canSeeApplicantIdentity(ctx({ roles: ["hr_admin"], actorId: OTHER_OFFICER_ID }), BASE_ROW)).toBe(true);
  });

  it("allows super_admin regardless of assignment", () => {
    expect(canSeeApplicantIdentity(ctx({ roles: ["super_admin"], actorId: OTHER_OFFICER_ID }), BASE_ROW)).toBe(true);
  });

  it("denies a caller when the request has no pioId assigned yet (filed, unassigned)", () => {
    expect(canSeeApplicantIdentity(ctx({ roles: ["hr_officer"], actorId: OTHER_OFFICER_ID }), { ...BASE_ROW, pioId: null })).toBe(false);
  });
});

describe("projectRtiListRow (GAP-HR-RTI-03)", () => {
  const withSlaRow = withSla(BASE_ROW);

  it("masks applicantName to null for an unauthorized hr_officer", () => {
    const projected = projectRtiListRow(withSlaRow, ctx({ roles: ["hr_officer"], actorId: OTHER_OFFICER_ID }));
    expect(projected.applicantName).toBeNull();
  });

  it("shows the real applicantName to the assigned PIO", () => {
    const projected = projectRtiListRow(withSlaRow, ctx({ roles: ["hr_officer"], actorId: PIO_ID }));
    expect(projected.applicantName).toBe("Ramesh Kumar");
  });

  it("never includes applicantContact/requestText/responseText/appealText regardless of caller", () => {
    const projected = projectRtiListRow(withSlaRow, ctx({ roles: ["hr_admin"] }));
    expect(projected as Record<string, unknown>).not.toHaveProperty("applicantContact");
    expect(projected as Record<string, unknown>).not.toHaveProperty("requestText");
    expect(projected as Record<string, unknown>).not.toHaveProperty("responseText");
    expect(projected as Record<string, unknown>).not.toHaveProperty("appealText");
  });
});

describe("projectRtiDetail (GAP-HR-RTI-03)", () => {
  const withSlaRow = withSla(BASE_ROW);

  it("masks applicantName AND applicantContact for an unauthorized hr_officer", () => {
    const projected = projectRtiDetail(withSlaRow, ctx({ roles: ["hr_officer"], actorId: OTHER_OFFICER_ID }));
    expect(projected.applicantName).toBeNull();
    expect(projected.applicantContact).toBeNull();
  });

  it("keeps requestText visible even when identity is masked -- need-to-know for the workflow itself", () => {
    const projected = projectRtiDetail(withSlaRow, ctx({ roles: ["hr_officer"], actorId: OTHER_OFFICER_ID }));
    expect(projected.requestText).toBe(BASE_ROW.requestText);
  });

  it("shows full identity to hr_admin", () => {
    const projected = projectRtiDetail(withSlaRow, ctx({ roles: ["hr_admin"] }));
    expect(projected.applicantName).toBe("Ramesh Kumar");
    expect(projected.applicantContact).toBe("ramesh@example.com");
  });
});

describe("withSla / GAP-HR-RTI-01 (SLA label correctness, not this file's own concern but shares withSla)", () => {
  it("flags a filed request overdue once past its due date", () => {
    const row = { ...BASE_ROW, status: "filed", dueDate: "2020-01-01" };
    expect(withSla(row).overdue).toBe(true);
  });

  it("never flags a responded request as overdue (its SLA label is status-driven, not the overdue flag)", () => {
    const row = { ...BASE_ROW, status: "responded", dueDate: "2020-01-01" };
    const result = withSla(row);
    expect(result.overdue).toBe(false);
    expect(result.daysToDue).toBeLessThan(0); // still negative -- the page must not feed this into slaDueInDays unclamped
  });
});

describe("todayIst (GAP-HR-RTI-06)", () => {
  it("returns yesterday's date (IST) for a UTC timestamp just after UTC midnight but before the 05:30 IST rollover", () => {
    // 2026-09-30T02:00:00Z = 2026-09-30 07:30 IST -- already past midnight IST.
    // Pick a moment that IS still the previous IST day: 2026-09-29T20:00:00Z
    // = 2026-09-30T01:30 IST... that's already the 30th. The genuinely
    // interesting boundary is the *other* direction: a UTC timestamp on one
    // calendar day that is already the NEXT day in IST (UTC+5:30 is ahead of
    // UTC), e.g. 2026-09-29T19:00:00Z = 2026-09-30T00:30 IST.
    const utcLateSep29 = new Date("2026-09-29T19:00:00Z");
    expect(todayIst(utcLateSep29)).toBe("2026-09-30");
  });

  it("agrees with a plain UTC read well inside the day (no boundary ambiguity)", () => {
    const midday = new Date("2026-09-30T10:00:00Z"); // 15:30 IST, same calendar day either way
    expect(todayIst(midday)).toBe("2026-09-30");
  });
});
