import { describe, it, expect } from "vitest";
import { parsePfmsConfig } from "./types";

// GAP-FINANCE-PFMS-05: the type guard drops anything that is not an exact known value.
describe("parsePfmsConfig", () => {
  it("keeps valid paymentRail / treasuryMode", () => {
    expect(parsePfmsConfig({ agencyCode: "AG", defaultDdo: "D", paymentRail: "disabled", treasuryMode: "sandbox" })).toMatchObject({
      agencyCode: "AG", paymentRail: "disabled", treasuryMode: "sandbox",
    });
  });
  it("drops unknown values instead of casting them through", () => {
    const c = parsePfmsConfig({ agencyCode: null, defaultDdo: null, paymentRail: "yes", treasuryMode: "LIVE" })!;
    expect(c).not.toHaveProperty("paymentRail");
    expect(c).not.toHaveProperty("treasuryMode");
  });
  it("ignores the retired single `mode` field and rejects non-objects", () => {
    expect(parsePfmsConfig({ agencyCode: null, defaultDdo: null, mode: "sandbox" })).not.toHaveProperty("mode");
    expect(parsePfmsConfig(null)).toBeNull();
    expect(parsePfmsConfig("x")).toBeNull();
  });
});
