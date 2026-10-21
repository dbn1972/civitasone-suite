import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { grievanceStatusLabel, grievancePriorityPillClass, GRIEVANCE_PRIORITY_PILL } from "./grievanceDisplay";

describe("grievanceStatusLabel (GAP-CRM-GRIEVANCES-06)", () => {
  it("relabels only APPEAL, case-insensitively and ignoring padding", () => {
    expect(grievanceStatusLabel("APPEAL", "First appeal")).toBe("First appeal");
    expect(grievanceStatusLabel("appeal", "First appeal")).toBe("First appeal");
    expect(grievanceStatusLabel(" Appeal ", "First appeal")).toBe("First appeal");
  });

  it.each(["REGISTERED", "FORWARDED", "ATTENDED", "DISPOSED", "", "APPEALED"])(
    "leaves %j to the shared humanised StatusPill default",
    (status) => {
      expect(grievanceStatusLabel(status, "First appeal")).toBeUndefined();
    },
  );
});

describe("grievancePriorityPillClass", () => {
  it("maps each priority to a shared pill tone", () => {
    expect(grievancePriorityPillClass("urgent")).toBe("pill bad");
    expect(grievancePriorityPillClass("high")).toBe("pill warn");
    expect(grievancePriorityPillClass("normal")).toBe("pill mut");
    expect(grievancePriorityPillClass("low")).toBe("pill mut");
  });

  it("falls back to the neutral tone for an unknown priority", () => {
    expect(grievancePriorityPillClass("whatever")).toBe("pill mut");
  });

  it("covers exactly the four priorities crm-service accepts", () => {
    expect(Object.keys(GRIEVANCE_PRIORITY_PILL).sort()).toEqual(["high", "low", "normal", "urgent"]);
  });
});

// GAP-CRM-GRIEVANCES-06: one label for the first-appeal state wherever the register names it.
describe("'First appeal' wording is consistent across list, table, filter and detail", () => {
  it("en: table pill, filter option and detail timeline/pill all say the same thing; the tile extends it", () => {
    expect(en.crmGrievancesTable.statusFirstAppeal).toBe("First appeal");
    expect(en.crmGrievanceFilters.statusAppeal).toBe("First appeal");
    expect(en.crmGrievanceDetail.stepFirstAppeal).toBe("First appeal");
    expect(en.crmGrievancesList.statFirstAppeal.startsWith("First appeal")).toBe(true);
  });

  it("hi: the same one term (प्रथम अपील) everywhere", () => {
    expect(hi.crmGrievancesTable.statusFirstAppeal).toBe("प्रथम अपील");
    expect(hi.crmGrievanceFilters.statusAppeal).toBe("प्रथम अपील");
    expect(hi.crmGrievanceDetail.stepFirstAppeal).toBe("प्रथम अपील");
    expect(hi.crmGrievancesList.statFirstAppeal.startsWith("प्रथम अपील")).toBe(true);
  });
});
