import { describe, it, expect } from "vitest";
import { formatSuccessRate, successRatePercent, summarizeGateways, toGatewayRow } from "./gatewayModel";

// GAP-ADMIN-GATEWAYS-05
describe("success rate / numbers", () => {
  it("0.987 renders 98.7%, 98.7 renders 98.7%, garbage renders a dash", () => {
    expect(formatSuccessRate(successRatePercent(0.987))).toBe("98.7%");
    expect(formatSuccessRate(successRatePercent(98.7))).toBe("98.7%");
    expect(formatSuccessRate(successRatePercent("99.5%"))).toBe("99.5%");
    expect(formatSuccessRate(successRatePercent("n/a"))).toBe("—");
    expect(formatSuccessRate(successRatePercent(undefined))).toBe("—");
  });
  it("keeps messagesPerDay numeric so the table sorts numerically", () => {
    expect(toGatewayRow({ messagesPerDay: 1500 }).messagesPerDay).toBe(1500);
    expect(toGatewayRow({ messagesPerDay: "x" }).messagesPerDay).toBeNull();
  });
  it("formats lastChecked as a date, passing an unparseable value through", () => {
    expect(toGatewayRow({ lastChecked: "2024-01-15T19:00:00.000Z" }).lastChecked).toBe("16 Jan 2024, 12:30 am");
    expect(toGatewayRow({ lastChecked: "yesterday" }).lastChecked).toBe("yesterday");
    expect(toGatewayRow({}).lastChecked).toBe("—");
  });
});

// GAP-ADMIN-GATEWAYS-04
describe("summary", () => {
  it("[active, down, standby, degraded] -> one each; an outage is never Standby", () => {
    const s = summarizeGateways(["active", "down", "standby", "degraded"].map((status) => toGatewayRow({ status })));
    expect(s).toEqual({ total: 4, active: 1, degraded: 1, standby: 1, down: 1, other: 0 });
  });
  it("failed/error/outage count as down; unknown statuses are 'other'", () => {
    const s = summarizeGateways(["failed", "Error", "outage", "weird"].map((status) => toGatewayRow({ status })));
    expect(s).toMatchObject({ down: 3, other: 1, standby: 0 });
  });
});
