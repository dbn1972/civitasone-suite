import { describe, it, expect } from "vitest";
import { cronToHuman } from "./cron";

describe("cronToHuman (GAP-ADMIN-SCHEDULED-JOBS-06)", () => {
  it("formats the daily preset with AM/PM, matching the preset label", () => {
    expect(cronToHuman("0 8 * * *")).toBe("Every day at 08:00 AM");
    expect(cronToHuman("30 14 * * *")).toBe("Every day at 02:30 PM");
  });
  it("names the weekday and the monthly case", () => {
    expect(cronToHuman("0 8 * * 1")).toBe("Every Monday at 08:00 AM");
    expect(cronToHuman("0 2 1 * *")).toBe("1st of every month at 02:00 AM");
    expect(cronToHuman("0 9 * * 1-5")).toBe("Weekdays at 09:00 AM");
  });
  it("handles the interval presets", () => {
    expect(cronToHuman("0 * * * *")).toBe("Every hour");
    expect(cronToHuman("*/15 * * * *")).toBe("Every 15 minutes");
    expect(cronToHuman("*/30 * * * *")).toBe("Every 30 minutes");
  });
  it("never invents a description for steps/lists in the hour field (used to print garbage like 08:*)", () => {
    expect(cronToHuman("0 8,20 * * *")).toBe("0 8,20 * * *");
    expect(cronToHuman("5 * * * *")).toBe("5 * * * *");
  });
  it("guards step ranges: */0 and out-of-range steps stay raw (GAP-ADMIN-SCHEDULED-JOBS-06)", () => {
    expect(cronToHuman("*/0 * * * *")).toBe("*/0 * * * *");
    expect(cronToHuman("*/75 * * * *")).toBe("*/75 * * * *");
    expect(cronToHuman("0 */0 * * *")).toBe("0 */0 * * *");
    expect(cronToHuman("0 */24 * * *")).toBe("0 */24 * * *");
    expect(cronToHuman("0 */2 * * *")).toBe("Every 2 hours at minute 0");
    expect(cronToHuman("*/1 * * * *")).toBe("Every minute");
  });
  it("returns malformed input verbatim", () => {
    expect(cronToHuman("daily")).toBe("daily");
    expect(cronToHuman("0 25 * * *")).toBe("0 25 * * *");
  });
});
