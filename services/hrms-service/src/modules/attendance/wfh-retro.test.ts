import { describe, it, expect } from "vitest";
import { wfhRetrospectiveRefusal, WFH_RETRO_MAX_DAYS } from "./wfh-retro.js";

const TODAY = "2026-11-26";
const base = { todayIst: TODAY, actorIsHr: false, reason: undefined as string | undefined };

describe("GAP-HR-WFH-06 -- retrospective WFH (employee none, HR up to 7 days with a reason)", () => {
  it("today and the future are never retrospective", () => {
    expect(wfhRetrospectiveRefusal({ ...base, fromDate: TODAY })).toBeNull();
    expect(wfhRetrospectiveRefusal({ ...base, fromDate: "2026-12-01" })).toBeNull();
  });

  it("an employee may not back-date at all, even by one day", () => {
    expect(wfhRetrospectiveRefusal({ ...base, fromDate: "2026-11-25", reason: "forgot to file earlier" })?.code).toBe("RETROSPECTIVE_WFH_NOT_ALLOWED");
  });

  it("HR may record up to 7 days back with a reason", () => {
    expect(WFH_RETRO_MAX_DAYS).toBe(7);
    expect(wfhRetrospectiveRefusal({ ...base, actorIsHr: true, fromDate: "2026-11-19", reason: "worked remotely, floods in the area" })).toBeNull();
  });

  it("HR may not go back 8 days", () => {
    expect(wfhRetrospectiveRefusal({ ...base, actorIsHr: true, fromDate: "2026-11-18", reason: "worked remotely, floods in the area" })?.code).toBe("RETROSPECTIVE_WFH_WINDOW_EXCEEDED");
  });

  it("HR must give a real reason for a back-dated entry", () => {
    expect(wfhRetrospectiveRefusal({ ...base, actorIsHr: true, fromDate: "2026-11-24" })?.code).toBe("RETROSPECTIVE_WFH_REASON_REQUIRED");
    expect(wfhRetrospectiveRefusal({ ...base, actorIsHr: true, fromDate: "2026-11-24", reason: "  short " })?.code).toBe("RETROSPECTIVE_WFH_REASON_REQUIRED");
  });
});
