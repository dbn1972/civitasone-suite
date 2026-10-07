import { describe, it, expect } from "vitest";
import { resolveHumanError } from "./errorCatalogue";

/**
 * GAP-CHANGE-DETAIL-05: a 409 freeze-overlap / maker-checker / invalid-transition
 * failure must read as its specific, actionable reason — never the generic
 * "changed by someone else" conflict copy or a bare retry message.
 */
describe("change domain error codes (GAP-CHANGE-DETAIL-05)", () => {
  it("maps FREEZE_CONFLICT to freeze-specific copy, not generic conflict", () => {
    const r = resolveHumanError({ status: 409, code: "FREEZE_CONFLICT", ctx: { locale: "en" } });
    expect(r.kind).toBe("domain");
    expect(r.what.toLowerCase()).toContain("freeze");
    expect(r.what.toLowerCase()).not.toContain("changed by someone else");
  });

  it("maps ROLLBACK_REQUIRED to rollback-plan copy", () => {
    const r = resolveHumanError({ status: 422, code: "ROLLBACK_REQUIRED", ctx: { locale: "en" } });
    expect(r.what.toLowerCase()).toContain("rollback plan");
  });

  it("maps MAKER_CHECKER_VIOLATION to a 'different person' message", () => {
    const r = resolveHumanError({ status: 409, code: "MAKER_CHECKER_VIOLATION", ctx: { locale: "en" } });
    expect(r.what.toLowerCase()).toContain("approval");
  });

  it("maps INVALID_TRANSITION to a refresh-and-retry message", () => {
    const r = resolveHumanError({ status: 409, code: "INVALID_TRANSITION", ctx: { locale: "en" } });
    expect(r.next.toLowerCase()).toContain("refresh");
  });

  it("still gives generic conflict copy for an uncatalogued 409 (network vs freeze stays distinct)", () => {
    const r = resolveHumanError({ status: 409, ctx: { locale: "en", area: "change request" } });
    expect(r.what.toLowerCase()).not.toContain("freeze");
  });

  it("has Hindi parity for FREEZE_CONFLICT", () => {
    const r = resolveHumanError({ status: 409, code: "FREEZE_CONFLICT", ctx: { locale: "hi" } });
    expect(r.what).toContain("फ़्रीज़");
  });
});
