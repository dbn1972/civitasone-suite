import { describe, it, expect } from "vitest";
import { aparDeadline } from "./deadlines.js";
import { resolvePolicy } from "../policy-settings/registry.js";

const defaults = resolvePolicy("apar_deadlines", undefined);

describe("aparDeadline (GAP-HR-APAR-03)", () => {
  it("defaults: officer-stage dates fall in the calendar year after the FY starts", () => {
    const p = "2025-26";
    expect(aparDeadline({ status: "self_pending", appraisalPeriod: p }, defaults)).toBe("2026-04-30");
    expect(aparDeadline({ status: "reporting_officer", appraisalPeriod: p }, defaults)).toBe("2026-05-31");
    expect(aparDeadline({ status: "reviewing_officer", appraisalPeriod: p }, defaults)).toBe("2026-06-30");
    expect(aparDeadline({ status: "accepting_authority", appraisalPeriod: p }, defaults)).toBe("2026-07-31");
  });
  it("a disclosed (or representation) record is due on its own representationDue, as a string or a Date", () => {
    expect(aparDeadline({ status: "disclosed", appraisalPeriod: "2025-26", representationDue: "2026-08-14" }, defaults)).toBe("2026-08-14");
    expect(aparDeadline({ status: "representation", appraisalPeriod: "2025-26", representationDue: new Date("2026-08-14T00:00:00Z") }, defaults)).toBe("2026-08-14");
    expect(aparDeadline({ status: "disclosed", appraisalPeriod: "2025-26", representationDue: null }, defaults)).toBeNull();
  });
  it("finalised, unknown statuses and malformed periods have no deadline", () => {
    expect(aparDeadline({ status: "finalised", appraisalPeriod: "2025-26" }, defaults)).toBeNull();
    expect(aparDeadline({ status: "weird", appraisalPeriod: "2025-26" }, defaults)).toBeNull();
    expect(aparDeadline({ status: "self_pending", appraisalPeriod: "FY26" }, defaults)).toBeNull();
  });
  it("a tenant's own calendar wins, and an impossible date (02-30) yields no deadline rather than a wrong one", () => {
    const custom = resolvePolicy("apar_deadlines", { self_pending: "05-15", reporting_officer: "02-30" });
    expect(aparDeadline({ status: "self_pending", appraisalPeriod: "2025-26" }, custom)).toBe("2026-05-15");
    expect(aparDeadline({ status: "reporting_officer", appraisalPeriod: "2025-26" }, custom)).toBeNull();
    expect(aparDeadline({ status: "reviewing_officer", appraisalPeriod: "2025-26" }, custom)).toBe("2026-06-30");
  });
  it("a stored policy with a bad value falls back to the defaults instead of throwing", () => {
    const broken = resolvePolicy("apar_deadlines", { self_pending: "tomorrow" });
    expect(aparDeadline({ status: "self_pending", appraisalPeriod: "2025-26" }, broken)).toBe("2026-04-30");
  });
});
