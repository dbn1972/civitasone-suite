/**
 * GAP-CITIZEN-RTI-DETAIL-01: appeal eligibility (§19(1)) is a pure domain rule
 * (isAppealAllowed) so it is unit-testable without a database. The route maps a
 * false result to 409 APPEAL_NOT_ALLOWED.
 */
import { describe, it, expect } from "vitest";
import { isAppealAllowed, computeRtiDeadline } from "../src/modules/rti/domain.js";

describe("isAppealAllowed (RTI Act §19 first-appeal eligibility)", () => {
  const now = new Date("2026-02-15T00:00:00Z");

  it("allows an appeal once a response has been recorded (aggrieved by the decision)", () => {
    const deadline = new Date("2026-03-01T00:00:00Z"); // still in future
    expect(isAppealAllowed({ hasResponse: true, deadline, now })).toBe(true);
  });

  it("allows an appeal after the 30-day deadline has lapsed with no response (deemed refusal)", () => {
    const deadline = new Date("2026-02-01T00:00:00Z"); // already past
    expect(isAppealAllowed({ hasResponse: false, deadline, now })).toBe(true);
  });

  it("refuses a premature appeal: no response AND still within the 30-day clock", () => {
    const deadline = new Date("2026-03-01T00:00:00Z"); // future
    expect(isAppealAllowed({ hasResponse: false, deadline, now })).toBe(false);
  });

  it("refuses exactly on the deadline boundary (not yet lapsed)", () => {
    const deadline = new Date("2026-02-15T00:00:00Z"); // == now
    expect(isAppealAllowed({ hasResponse: false, deadline, now })).toBe(false);
  });

  it("fails closed on an unparseable deadline (no response)", () => {
    expect(isAppealAllowed({ hasResponse: false, deadline: "not-a-date", now })).toBe(false);
  });

  it("accepts a bare YYYY-MM-DD deadline string (the shape the read model stores)", () => {
    expect(isAppealAllowed({ hasResponse: false, deadline: "2026-02-01", now })).toBe(true);
    expect(isAppealAllowed({ hasResponse: false, deadline: "2026-03-01", now })).toBe(false);
  });

  it("composes with computeRtiDeadline: 30 days after filing is not yet appealable", () => {
    const filed = new Date("2026-02-10T00:00:00Z");
    const deadline = computeRtiDeadline(filed); // 2026-03-12
    expect(isAppealAllowed({ hasResponse: false, deadline, now })).toBe(false);
  });
});
