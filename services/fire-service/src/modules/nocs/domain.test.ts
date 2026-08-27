/**
 * Regression test (independent review of #825, MEDIUM finding): checkNocEligibility
 * used to check inspections.some(...) — ANY historical inspection with a
 * completed+approve outcome — instead of only the MOST RECENT one. A building
 * whose first inspection passed but whose later re-inspection came back
 * "reject" would still pass eligibility because of the stale earlier
 * approval. inspections/repo.ts's findByApplicationId returns rows sorted
 * newest-first (`.orderBy(desc(createdAt))`), which both call sites
 * (nocs/routes.ts, nocs/consumer.ts) pass straight into this function
 * unmodified — these tests assume that same newest-first ordering.
 */
import { describe, it, expect } from "vitest";
import { checkNocEligibility } from "./domain.js";

const approved = (overrides: Record<string, unknown> = {}) => ({ status: "completed", recommendation: "approve", ...overrides });
const rejected = (overrides: Record<string, unknown> = {}) => ({ status: "completed", recommendation: "reject", ...overrides });

describe("checkNocEligibility", () => {
  it("is ineligible when the application does not exist", () => {
    const result = checkNocEligibility(null, [approved()]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });

  it("is eligible when the most recent (first) inspection is completed+approve", () => {
    const result = checkNocEligibility({ status: "submitted" }, [approved()]);
    expect(result.eligible).toBe(true);
  });

  it("is ineligible when there are no inspections at all", () => {
    const result = checkNocEligibility({ status: "submitted" }, []);
    expect(result.eligible).toBe(false);
  });

  it("is ineligible when the most recent inspection is a rejection, even if an EARLIER one was approved", () => {
    // newest-first order: index 0 is the later, failing re-inspection.
    const result = checkNocEligibility({ status: "submitted" }, [rejected(), approved()]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/most recent inspection/i);
  });

  it("is eligible when an earlier inspection was rejected but the most recent one approved", () => {
    const result = checkNocEligibility({ status: "submitted" }, [approved(), rejected()]);
    expect(result.eligible).toBe(true);
  });

  it("is ineligible when the most recent inspection is completed but recommends re_inspect, not approve", () => {
    const result = checkNocEligibility({ status: "submitted" }, [approved({ recommendation: "re_inspect" })]);
    expect(result.eligible).toBe(false);
  });

  it("is ineligible when the most recent inspection hasn't completed yet (still scheduled)", () => {
    const result = checkNocEligibility({ status: "submitted" }, [{ status: "scheduled", recommendation: null }]);
    expect(result.eligible).toBe(false);
  });
});
