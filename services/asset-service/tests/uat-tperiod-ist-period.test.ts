/** UAT T-PERIOD D-06 (bundle 19): the depreciation scheduler month is the IST month, not the UTC month. */
import { describe, it, expect } from "vitest";
import { currentPeriod } from "../src/modules/depreciation/scheduler.js";
import { todayIST, currentFyIST } from "../src/shared/ist-date.js";

describe("IST accounting month", () => {
  it("23:59 IST on 31 March is March; 00:01 IST on 1 April is April (the UTC month would still be March)", () => {
    expect(currentPeriod(new Date("2027-03-31T18:29:00Z"))).toBe("2027-03");
    expect(currentPeriod(new Date("2027-03-31T18:31:00Z"))).toBe("2027-04");
    expect(todayIST(new Date("2027-03-31T18:31:00Z"))).toBe("2027-04-01");
    expect(currentFyIST(new Date("2027-03-31T18:31:00Z"))).toBe("2027-28");
  });
});
