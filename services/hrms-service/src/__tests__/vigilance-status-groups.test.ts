/**
 * GAP-HR-VIGILANCE-02: VIGILANCE_STATUS_GROUPS must put each of the 10
 * CaseStatus values in exactly one bucket (so the stat cards sum to Total),
 * and penalty/appeal stages must not be counted as "under inquiry".
 */
import { describe, it, expect } from "vitest";
import { VIGILANCE_STATUS_GROUPS, type CaseStatus } from "../modules/disciplinary/state-machine.js";

const ALL_STATUSES: CaseStatus[] = [
  "opened", "charge_memo_issued", "inquiry_appointed", "finding_recorded", "pending_approval",
  "penalty_imposed", "appeal_filed", "appeal_decided", "closed", "dropped",
];

describe("VIGILANCE_STATUS_GROUPS", () => {
  it("places every CaseStatus in exactly one bucket", () => {
    for (const st of ALL_STATUSES) {
      const homes = Object.entries(VIGILANCE_STATUS_GROUPS).filter(([, list]) => (list as readonly string[]).includes(st));
      expect(homes, st).toHaveLength(1);
    }
    const total = Object.values(VIGILANCE_STATUS_GROUPS).reduce((n, l) => n + l.length, 0);
    expect(total).toBe(ALL_STATUSES.length);
  });

  it("counts penalty_imposed and appeal_filed under penaltyAndAppeal, not underInquiry", () => {
    expect(VIGILANCE_STATUS_GROUPS.penaltyAndAppeal).toContain("penalty_imposed");
    expect(VIGILANCE_STATUS_GROUPS.penaltyAndAppeal).toContain("appeal_filed");
    expect(VIGILANCE_STATUS_GROUPS.underInquiry).not.toContain("penalty_imposed");
    expect(VIGILANCE_STATUS_GROUPS.underInquiry).not.toContain("appeal_filed");
  });
});
