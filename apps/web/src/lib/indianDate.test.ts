import { describe, it, expect } from "vitest";
import { dateTextError, isoToIndianText, maskIndianDateText, parseIndianDateText } from "./indianDate";

describe("indianDate: DD-MM-YYYY entry, ISO underneath", () => {
  it("ISO <-> Indian text", () => {
    expect(isoToIndianText("2026-11-04")).toBe("04-11-2026");
    expect(isoToIndianText("bad")).toBe("");
    expect(parseIndianDateText("04-11-2026")).toBe("2026-11-04");
    expect(parseIndianDateText("04/11/2026")).toBe("2026-11-04");
    expect(parseIndianDateText("04.11.2026")).toBe("2026-11-04");
  });

  it("is always day first (02-11-2026 is 2 November, never 11 February)", () => {
    expect(parseIndianDateText("02-11-2026")).toBe("2026-11-02");
  });

  it("rejects impossible dates", () => {
    expect(parseIndianDateText("31-02-2026")).toBeNull();
    expect(parseIndianDateText("29-02-2027")).toBeNull();
    expect(parseIndianDateText("29-02-2028")).toBe("2028-02-29");
  });

  it("masks as the officer types and converts a pasted ISO date", () => {
    expect(maskIndianDateText("0")).toBe("0");
    expect(maskIndianDateText("041")).toBe("04-1");
    expect(maskIndianDateText("04112026")).toBe("04-11-2026");
    expect(maskIndianDateText("041120269")).toBe("04-11-2026");
    expect(maskIndianDateText("2026-11-04")).toBe("04-11-2026");
    expect(maskIndianDateText("4/11/2026")).toBe("04-11-2026");
  });

  it("clear inline messages", () => {
    expect(dateTextError("", { required: true, label: "Posting date" })).toBe("Enter the posting date as DD-MM-YYYY.");
    expect(dateTextError("")).toBeUndefined();
    expect(dateTextError("31-02-2026")).toBe("31-02-2026 is not a real date. Check the day and month.");
    expect(dateTextError("4-11", { label: "Indent date" })).toBe("Enter the indent date as DD-MM-YYYY, for example 04-11-2026.");
    expect(dateTextError("01-01-2026", { min: "2026-04-01", label: "Date" })).toBe("Date cannot be before 01-04-2026.");
    expect(dateTextError("01-01-2027", { max: "2026-12-31", label: "Date" })).toBe("Date cannot be after 31-12-2026.");
    expect(dateTextError("15-06-2026", { min: "2026-04-01", max: "2026-12-31" })).toBeUndefined();
  });
});
