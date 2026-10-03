import { describe, it, expect } from "vitest";
import { canCancelInstrument, chequeStatusIcon, chequeStatusLabel, clearedDateLabel, INSTRUMENT_WRITE_ROLES } from "./chequeUi";

describe("cheque detail helpers (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04 / -06)", () => {
  it("maps each lifecycle status to its own icon, neutral note otherwise", () => {
    expect(chequeStatusIcon("cleared")).toBe("✅");
    expect(chequeStatusIcon("presented")).toBe("⏳");
    expect(chequeStatusIcon("bounced")).toBe("❌");
    expect(chequeStatusIcon("cancelled")).toBe("⛔");
    expect(chequeStatusIcon("issued")).toBe("📝");
    expect(chequeStatusIcon(null)).toBe("📝");
  });

  it("humanises the status for the stat card", () => {
    expect(chequeStatusLabel("bounced")).toBe("Bounced");
    expect(chequeStatusLabel("")).toBe("—");
  });

  it("offers Cancel only where finance-service allows it (issued)", () => {
    expect(canCancelInstrument("issued")).toBe(true);
    for (const s of ["presented", "cleared", "bounced", "cancelled", "", null, undefined]) {
      expect(canCancelInstrument(s)).toBe(false);
    }
  });

  it("is not offered to audit / budget roles", () => {
    expect(INSTRUMENT_WRITE_ROLES).not.toContain("audit_officer");
    expect(INSTRUMENT_WRITE_ROLES).toContain("finance_officer");
  });

  it("says 'Not cleared' for an expected absence and formats a real date", () => {
    expect(clearedDateLabel(null, "bounced")).toBe("Not cleared");
    expect(clearedDateLabel(null, "presented")).toBe("Not cleared");
    expect(clearedDateLabel("2025-03-05T10:00:00Z", "cleared")).toBe("05 Mar 2025");
  });
});
