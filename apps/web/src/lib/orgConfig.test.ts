import { describe, it, expect } from "vitest";
import { getTerminology, ORG_TYPES, ORG_TYPE_LABELS } from "./orgConfig";

describe("getTerminology", () => {
  it("returns govt_dept terminology by default (null input)", () => {
    const t = getTerminology(null);
    expect(t.orgUnit).toBe("office");
    expect(t.financeHead).toBe("DDO");
    expect(t.govtTerms).toBe(true);
    expect(t.cpcPayMatrix).toBe(true);
  });

  it("returns govt_dept terminology for undefined input", () => {
    const t = getTerminology(undefined);
    expect(t.orgUnit).toBe("office");
  });

  it("returns govt_dept terminology for unknown org type", () => {
    const t = getTerminology("invalid_type");
    expect(t.orgUnit).toBe("office");
  });

  it("returns PSU terminology", () => {
    const t = getTerminology("psu");
    expect(t.orgUnit).toBe("company");
    expect(t.financeHead).toBe("CFO");
    expect(t.salary).toBe("CTC");
    expect(t.govtTerms).toBe(false);
    expect(t.cpcPayMatrix).toBe(false);
  });

  it("returns private company terminology", () => {
    const t = getTerminology("private");
    expect(t.orgHead).toBe("CEO");
    expect(t.approval).toBe("Submit for approval");
  });

  it("returns municipal terminology with govt terms", () => {
    const t = getTerminology("municipal");
    expect(t.orgUnit).toBe("corporation");
    expect(t.orgHead).toBe("Commissioner");
    expect(t.govtTerms).toBe(true);
    expect(t.ccsLeaveRules).toBe(true);
  });

  it("returns NGO terminology", () => {
    const t = getTerminology("ngo");
    expect(t.orgUnit).toBe("organisation");
    expect(t.orgHead).toBe("Executive Director");
    expect(t.ccsLeaveRules).toBe(false);
  });

  it("returns cooperative terminology", () => {
    const t = getTerminology("cooperative");
    expect(t.orgUnit).toBe("society");
    expect(t.financeHead).toBe("Treasurer");
  });

  it("returns educational terminology", () => {
    const t = getTerminology("educational");
    expect(t.orgUnit).toBe("institution");
    expect(t.branch).toBe("campus");
    expect(t.cpcPayMatrix).toBe(true);
  });

  it("returns govt_autonomous terminology", () => {
    const t = getTerminology("govt_autonomous");
    expect(t.orgUnit).toBe("organisation");
    expect(t.orgHead).toBe("Director");
    expect(t.ccsLeaveRules).toBe(true);
  });
});

describe("ORG_TYPES constant", () => {
  it("contains all 8 org types", () => {
    expect(ORG_TYPES).toHaveLength(8);
    expect(ORG_TYPES).toContain("govt_dept");
    expect(ORG_TYPES).toContain("psu");
    expect(ORG_TYPES).toContain("private");
    expect(ORG_TYPES).toContain("ngo");
  });
});

describe("ORG_TYPE_LABELS", () => {
  it("has a display label for each org type", () => {
    for (const t of ORG_TYPES) {
      expect(ORG_TYPE_LABELS[t]).toBeDefined();
      expect(typeof ORG_TYPE_LABELS[t]).toBe("string");
      expect(ORG_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
  });

  it("displays friendly name for govt_dept", () => {
    expect(ORG_TYPE_LABELS.govt_dept).toBe("Government Department");
  });
});
