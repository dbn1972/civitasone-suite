import { describe, it, expect } from "vitest";
import { riskScore, band, BAND_LABEL, statusLabel, LIKELIHOOD_LABEL } from "./riskScoring";

describe("riskScoring (GAP-AUDIT-RISK-REGISTER-01/02/03)", () => {
  it("computes score as likelihood x impact, mirroring the server (possible x moderate = 9)", () => {
    expect(riskScore("possible", "moderate")).toBe(9);
    expect(riskScore("almost_certain", "catastrophic")).toBe(25);
    expect(riskScore("rare", "negligible")).toBe(1);
  });

  it("bands 9 as Medium, >=15 as High, <6 as Low (display thresholds)", () => {
    expect(band(9)).toBe("medium");
    expect(BAND_LABEL[band(9)]).toBe("Medium");
    expect(band(15)).toBe("high");
    expect(band(5)).toBe("low");
  });

  it("labels likelihood for humans (almost_certain -> Almost certain)", () => {
    expect(LIKELIHOOD_LABEL.almost_certain).toBe("Almost certain");
  });

  it("maps each status one-to-one and keeps unknown statuses visible as raw neutral text", () => {
    expect(statusLabel("open")).toEqual({ label: "Open", tone: "info" });
    expect(statusLabel("mitigated")).toEqual({ label: "Mitigated", tone: "warn" });
    expect(statusLabel("closed")).toEqual({ label: "Controlled", tone: "good" });
    expect(statusLabel("escalated")).toEqual({ label: "Escalated", tone: "bad" });
    // An unrecognised status is NOT silently shown as "Monitored".
    expect(statusLabel("appeal_pending")).toEqual({ label: "appeal_pending", tone: "mut" });
  });
});
