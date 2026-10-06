import { describe, it, expect } from "vitest";
import { severityTone, severityRank, isCriticalSeverity, statusTone, isOpenSiemStatus } from "./siemHelpers";

describe("siemHelpers (GAP-TENANT-ADMIN-SIEM-02/03)", () => {
  it("ranks severity critical>high>medium>low", () => {
    expect(severityRank("critical")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
  });

  it("marks only critical as the most-urgent severity", () => {
    expect(isCriticalSeverity("critical")).toBe(true);
    expect(isCriticalSeverity("high")).toBe(false);
  });

  it("maps known statuses to deliberate tones and unknown to neutral (not warn)", () => {
    expect(statusTone("resolved")).toBe("good");
    expect(statusTone("closed")).toBe("good");
    expect(statusTone("detected")).toBe("bad");
    expect(statusTone("triaged")).toBe("warn");
    expect(statusTone("contained")).toBe("warn");
    expect(statusTone("something-unknown")).toBe("mut");
  });

  it("counts the open lifecycle states as active", () => {
    expect(isOpenSiemStatus("detected")).toBe(true);
    expect(isOpenSiemStatus("triaged")).toBe(true);
    expect(isOpenSiemStatus("contained")).toBe(true);
    expect(isOpenSiemStatus("resolved")).toBe(false);
    expect(isOpenSiemStatus("closed")).toBe(false);
  });

  it("gives critical and high the same red family but critical is flagged separately", () => {
    expect(severityTone("critical")).toBe("bad");
    expect(severityTone("high")).toBe("bad");
    expect(severityTone("medium")).toBe("warn");
    expect(severityTone("low")).toBe("info");
  });
});
