import { describe, it, expect } from "vitest";
import { networkKey, networkLabel, distinctNetworkCount, deviceLabel } from "./sessionHelpers";

describe("sessionHelpers — networks (GAP-TENANT-ADMIN-SESSIONS-03/05)", () => {
  it("collapses every RFC-1918 private range to one 'internal' network", () => {
    expect(networkKey("10.0.1.1")).toBe("internal");
    expect(networkKey("10.1.1.1")).toBe("internal");
    expect(networkKey("192.168.0.5")).toBe("internal");
    expect(networkKey("172.16.4.4")).toBe("internal");
    expect(networkKey("172.31.4.4")).toBe("internal");
  });

  it("does NOT collapse 172.15/172.32 (outside the private range)", () => {
    expect(networkKey("172.15.0.1")).not.toBe("internal");
    expect(networkKey("172.32.0.1")).not.toBe("internal");
  });

  it("counts 10.0.1.1 and 10.1.1.1 as a single internal network", () => {
    expect(distinctNetworkCount(["10.0.1.1", "10.1.1.1"])).toBe(1);
  });

  it("counts two different public networks as two", () => {
    expect(distinctNetworkCount(["203.0.113.1", "198.51.100.2"])).toBe(2);
  });

  it("ignores unknown/missing IPs in the distinct count", () => {
    expect(distinctNetworkCount([undefined, "", "10.0.0.1"])).toBe(1);
  });

  it("labels match the KPI grouping", () => {
    expect(networkLabel("10.0.1.1")).toBe("Internal network");
    expect(networkLabel("203.0.113.1")).toBe("203.0.x.x");
    expect(networkLabel(undefined)).toBe("—");
  });

  it("derives a device label from the user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/1")).toBe("Chrome · Windows");
    expect(deviceLabel(undefined)).toBe("Unknown device");
  });
});
