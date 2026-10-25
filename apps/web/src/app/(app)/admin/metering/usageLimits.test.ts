import { describe, it, expect } from "vitest";
import { limitCell } from "./usageLimits";

const r = (used: number, limit: number) => ({ resource: "users", label: "Users", unit: "users", used, limit });

describe("limitCell thresholds use the unrounded ratio (V4-A-08)", () => {
  it("996 of 1000 (99.6%) is warn, not over limit, and displays 99%", () => {
    const c = limitCell(r(996, 1000));
    expect(c.level).toBe("warn");
    expect(c.percent).toBe(99);
    expect(c.text).toBe("99% of limit");
  });

  it("exactly at the limit is bad; 100.4% is bad and floors to 100", () => {
    expect(limitCell(r(1000, 1000)).level).toBe("bad");
    expect(limitCell(r(1004, 1000))).toMatchObject({ level: "bad", percent: 100 });
  });

  it("79.5% is ok, exactly 80% is warn", () => {
    expect(limitCell(r(795, 1000)).level).toBe("ok");
    expect(limitCell(r(800, 1000)).level).toBe("warn");
  });

  it("no usable limit stays none", () => {
    expect(limitCell(r(5, 0)).level).toBe("none");
  });
});
