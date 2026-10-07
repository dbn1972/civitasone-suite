import { describe, it, expect } from "vitest";
import { mapLegalCaseSummaries } from "./apiMappers";

/**
 * GAP-LEGAL-LIST-04: cases.legal_cases.counsel_ref is a free-text counsel
 * reference (not a counsel-master join). The mapper now surfaces it as
 * advocateName so the list "Counsel" column shows the stored value instead of
 * always rendering "—".
 */
describe("mapLegalCaseSummaries — counsel mapping (GAP-LEGAL-LIST-04)", () => {
  it("maps counselRef onto advocateName", () => {
    const out = mapLegalCaseSummaries({
      items: [{ id: "c1", caseNo: "WP-1", title: "A v B", court: "HC", counselRef: "Sr. Adv. Rao" }],
    });
    expect(out![0].advocateName).toBe("Sr. Adv. Rao");
  });

  it("maps snake_case counsel_ref too", () => {
    const out = mapLegalCaseSummaries({
      items: [{ id: "c1", caseNo: "WP-1", title: "A v B", court: "HC", counsel_ref: "Adv. Mehta" }],
    });
    expect(out![0].advocateName).toBe("Adv. Mehta");
  });

  it("leaves advocateName undefined when there is no counsel ref", () => {
    const out = mapLegalCaseSummaries({
      items: [{ id: "c1", caseNo: "WP-1", title: "A v B", court: "HC" }],
    });
    expect(out![0].advocateName).toBeUndefined();
  });
});
