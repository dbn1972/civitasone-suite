import { describe, it, expect } from "vitest";
import { stageInfo } from "./stages";

describe("candidate stage map (GAP-RECRUITMENT-CAREERS-PORTAL-02)", () => {
  it("rejected and not_selected are terminal 'Not selected' with a message and no rail", () => {
    for (const s of ["rejected", "not_selected"]) {
      const i = stageInfo(s);
      expect(i.label).toBe("Not selected");
      expect(i.kind).toBe("terminal");
      expect(i.railIndex).toBe(-1);
      expect(i.message).toMatch(/not selected/i);
    }
  });
  it("withdrawn is terminal", () => {
    expect(stageInfo("withdrawn")).toMatchObject({ label: "Withdrawn", kind: "terminal" });
  });
  it("selected sits on the shortlisted step, labelled Selected", () => {
    expect(stageInfo("selected")).toMatchObject({ label: "Selected", kind: "rail", railIndex: stageInfo("shortlisted").railIndex });
  });
  it("an unknown stage never prints the raw word", () => {
    const i = stageInfo("foo");
    expect(i.label).toBe("In progress");
    expect(JSON.stringify(i)).not.toContain("foo");
    expect(i.kind).toBe("unknown");
  });
});
