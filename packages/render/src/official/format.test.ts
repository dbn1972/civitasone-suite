import { describe, it, expect } from "vitest";
import {
  formatInr, formatMinorIndian, formatIndianInteger, formatDateIst, formatDateTimeIst, formatMonthYear,
  maskPanForPrint, maskAccountForPrint, financialYearOf, toMinor,
} from "./format.js";
import { gstSplit, gstStateCode } from "./gst.js";
import { parseMarkdown, stripInlineMarkdown } from "./markdown.js";
import { docIdentityFromTenant, resolveSignatories, resolveDocIdentity, resetDocIdentityCache } from "./identity.js";

describe("Indian digit grouping", () => {
  it("groups by lakh and crore", () => {
    expect(formatMinorIndian(21_375_600n)).toBe("2,13,756.00");
    expect(formatInr(600_200n)).toBe("₹ 6,002.00");
    expect(formatInr(-150n)).toBe("-₹ 1.50");
    expect(formatIndianInteger(123_456_789n)).toBe("12,34,56,789");
    expect(formatMinorIndian("9007199254740993")).toBe("9,00,71,99,25,47,409.93");
  });
  it("rejects fractional paise", () => {
    expect(() => toMinor(1.5)).toThrow(RangeError);
    expect(() => toMinor("12.5")).toThrow(RangeError);
  });
});

describe("IST dates", () => {
  it("prints a timestamp in IST", () => {
    expect(formatDateTimeIst("2026-11-19T16:48:00.000Z")).toBe("19 Nov 2026, 10:18 PM IST");
    expect(formatDateTimeIst("2026-11-04T18:45:00.000Z")).toBe("05 Nov 2026, 12:15 AM IST");
  });
  it("a calendar date is printed as written", () => {
    expect(formatDateIst("2026-09-30")).toBe("30 Sep 2026");
    expect(formatDateIst("2026-09-30", "hi")).toBe("30 सितंबर 2026");
  });
  it("blank and invalid read as a dash", () => {
    expect(formatDateIst(null)).toBe("—");
    expect(formatDateTimeIst("not-a-date")).toBe("—");
  });
  it("pay period and financial year", () => {
    expect(formatMonthYear("2026-08")).toBe("August 2026");
    expect(formatMonthYear("2026-08", "hi")).toBe("अगस्त 2026");
    expect(financialYearOf("2027-03-31")).toBe("2026-27");
    expect(financialYearOf("2027-04-01")).toBe("2027-28");
  });
});

describe("masked identifiers", () => {
  it("PAN letters masked, digits shown", () => {
    expect(maskPanForPrint("abcde1234f")).toBe("XXXXX1234X");
    expect(maskPanForPrint("")).toBe("");
    expect(maskPanForPrint("BAD123")).toBe("XXD123");
  });
  it("bank account shows the last four only", () => {
    expect(maskAccountForPrint("123456789012")).toBe("XXXXXXXX9012");
  });
});

describe("GST split", () => {
  it("intra-State: CGST + SGST at half the rate each", () => {
    const s = gstSplit(600_200n, 1800, "29AAAAA0000A1Z5", "29BBBBB1111B1Z5");
    expect(s).toEqual({ kind: "intra", cgstMinor: 54_018n, sgstMinor: 54_018n, igstMinor: 0n, taxMinor: 108_036n });
  });
  it("inter-State: IGST", () => {
    const s = gstSplit(600_200n, 1800, "29AAAAA0000A1Z5", "07");
    expect(s.kind).toBe("inter");
    expect(s.igstMinor).toBe(108_036n);
  });
  it("unknown State: no split invented", () => {
    expect(gstSplit(100_00n, 1200, null, "07").kind).toBe("unknown");
    expect(gstStateCode("not a gstin")).toBeNull();
  });
});

describe("markdown", () => {
  it("headings, lists and emphasis become plain document blocks", () => {
    const md = "# Minutes\n\n## Attendance\n_No attendance recorded._\n\n- **Item 1**: approved\n1. Next step\n\n| A | B |\n|---|---|\n| x | y |";
    expect(parseMarkdown(md)).toEqual([
      { kind: "heading", level: 1, text: "Minutes" },
      { kind: "heading", level: 2, text: "Attendance" },
      { kind: "para", text: "No attendance recorded." },
      { kind: "item", marker: "•", text: "Item 1: approved" },
      { kind: "item", marker: "1.", text: "Next step" },
      { kind: "table", rows: [["A", "B"], ["x", "y"]] },
    ]);
    expect(stripInlineMarkdown("see [the order](http://x) and `code`")).toBe("see the order and code");
  });
});

describe("document identity", () => {
  it("reads settings.documentIdentity, falls back to the tenant name, derives the State code", () => {
    const d = docIdentityFromTenant({ name: "UAT Org", settings: { documentIdentity: { ministry: "Ministry of X", tan: "delx12345a", gstin: "07AAAAA0000A1Z5" } } });
    expect(d).toMatchObject({ orgName: "UAT Org", ministry: "Ministry of X", tan: "DELX12345A", gstin: "07AAAAA0000A1Z5", stateCode: "07", pan: null });
  });
  it("fails open to empty identity when tenant-service is down", async () => {
    resetDocIdentityCache();
    const d = await resolveDocIdentity("11111111-1111-1111-1111-111111111111", async () => { throw new Error("down"); });
    expect(d.orgName).toBeNull();
  });
  it("signatories: HRMS name + designation, identity name as fallback", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const calls: string[] = [];
    const fake = async (url: string) => {
      calls.push(url);
      if (url.includes("employee-summaries")) return { ok: true, json: async () => [{ fullName: "Asha Rao", designationName: "Under Secretary", userRef: a }, { fullName: "Old Key", designation: "Section Officer", userRef: c }] };
      return { ok: true, json: async () => [{ id: b, name: "Bharat Lal" }, { id: "x", name: "ignored" }] };
    };
    const m = await resolveSignatories("t", [a, b, c, null, "not-a-uuid"], fake);
    expect(m.get(c)).toEqual({ name: "Old Key", designation: "Section Officer" });
    expect(m.get(a)).toEqual({ name: "Asha Rao", designation: "Under Secretary" });
    expect(m.get(b)).toEqual({ name: "Bharat Lal", designation: null });
    expect(calls).toHaveLength(2);
  });
});
