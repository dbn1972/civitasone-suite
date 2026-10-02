import { describe, it, expect } from "vitest";
import { summariseServices, formatMemory, formatUptime } from "./techAdminModel";

describe("tech-admin model", () => {
  it("counts degraded explicitly and puts unrecognised statuses in Unknown (GAP-ADMIN-TECH-ADMIN-02/-03)", () => {
    const s = summariseServices([{ status: "running" }, { status: "online" }, { status: "stopped" }, { status: "errored" }, { status: "degraded" }, { status: "foo" }], false);
    expect(s).toEqual({ total: 6, running: 2, down: 2, degraded: 1, unknown: 1 });
  });
  it("is all-null (dashes) when nothing is available", () => {
    expect(summariseServices([], true)).toEqual({ total: null, running: null, down: null, degraded: null, unknown: null });
  });
  it("formats memory and uptime (GAP-ADMIN-TECH-ADMIN-05)", () => {
    expect(formatMemory(536870912)).toBe("512 MB");
    expect(formatMemory(1610612736)).toBe("1.5 GB");
    expect(formatMemory("512 MB")).toBe("512 MB");
    expect(formatMemory(null)).toBe("—");
    expect(formatUptime(90061)).toBe("1d 1h");
    expect(formatUptime(3900)).toBe("1h 5m");
    expect(formatUptime("2 days")).toBe("2 days");
    expect(formatUptime(undefined)).toBe("—");
  });
});
