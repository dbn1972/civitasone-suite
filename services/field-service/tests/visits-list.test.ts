import { describe, it, expect } from "vitest";
import { validateCheckIn, classifyVisitOutcome } from "../src/modules/visits/domain.js";

/**
 * P1-10: the FE list depends on GPS validation + outcome classification staying
 * honest — a bogus coordinate must not become a successful check-in row.
 */
describe("P1-10 visit list prerequisites", () => {
  it("rejects an out-of-range latitude before persistence", () => {
    expect(validateCheckIn({ latitude: 91, longitude: 77 })).toBeTruthy();
    expect(validateCheckIn({ latitude: 28.6, longitude: 77.2 })).toBeNull();
  });

  it("classifies short visits distinctly from completed ones", () => {
    expect(classifyVisitOutcome(2)).not.toEqual(classifyVisitOutcome(45));
  });
});
