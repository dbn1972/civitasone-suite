import { describe, it, expect } from "vitest";
import { ESCALATION_BANDS, bandLabel, bandForAmount } from "./escalationBands";

describe("escalation bands (GAP-PROCUREMENT-APPROVALS-ESCALATION-02)", () => {
  it("bands are contiguous and non-overlapping (half-open ranges)", () => {
    for (let i = 0; i < ESCALATION_BANDS.length - 1; i++) {
      const cur = ESCALATION_BANDS[i];
      const next = ESCALATION_BANDS[i + 1];
      // Each band's exclusive max is the next band's inclusive min — no gap,
      // no overlap.
      expect(cur.maxPaise).toBe(next.minPaise);
    }
    // Last band is open-ended.
    expect(ESCALATION_BANDS[ESCALATION_BANDS.length - 1].maxPaise).toBeNull();
    // First band starts at 0.
    expect(ESCALATION_BANDS[0].minPaise).toBe(0);
  });

  it("every boundary value matches exactly one band", () => {
    const boundaries = [
      0,
      1_00_000 * 100, // ₹1,00,000 exactly
      10_00_000 * 100, // ₹10,00,000 exactly
      50_00_000 * 100, // well above
    ];
    for (const paise of boundaries) {
      const matches = ESCALATION_BANDS.filter(
        (b) => paise >= b.minPaise && (b.maxPaise === null || paise < b.maxPaise),
      );
      expect(matches).toHaveLength(1);
    }
  });

  it("₹1,00,000 falls in the first (officer) band, ₹1,00,000.01 in the second", () => {
    expect(bandForAmount(1_00_000 * 100)?.approvingAuthority).toBe("Procurement Officer");
    expect(bandForAmount(1_00_000 * 100 + 1)?.approvingAuthority).toBe("Procurement Admin");
  });

  it("₹10,00,000 is still Admin; just over is Admin + Finance", () => {
    expect(bandForAmount(10_00_000 * 100)?.approvingAuthority).toBe("Procurement Admin");
    expect(bandForAmount(10_00_000 * 100 + 1)?.approvingAuthority).toBe("Procurement Admin + Finance");
  });

  it("labels never show a boundary amount in two bands", () => {
    const labels = ESCALATION_BANDS.map((b, i) => bandLabel(b, i));
    // First band is '... and below', later bands are 'Over ...'.
    expect(labels[0]).toMatch(/and below$/);
    expect(labels[1]).toMatch(/^Over /);
    expect(labels[2]).toMatch(/^Over /);
    // The middle band's lower edge reads "Over ₹1,00,000", so ₹1,00,000 is NOT
    // claimed by band 2 as an inclusive member.
    expect(labels[1]).toContain("Over");
  });
});
