import { describe, it, expect } from "vitest";
import { toCsv, csvCell } from "./csv";

describe("toCsv (GAP-ADMIN-USERS-06)", () => {
  it("quotes a name containing a comma so columns do not shift", () => {
    expect(csvCell("Doe, John")).toBe('"Doe, John"');
    expect(toCsv([["Name", "Email"], ["Doe, John", "j@x.gov.in"]])).toBe('"Name","Email"\r\n"Doe, John","j@x.gov.in"');
  });
  it("neutralises formula-leading cells", () => {
    expect(csvCell("=cmd|x")).toBe(`"'=cmd|x"`);
    expect(csvCell("+1+1")).toBe(`"'+1+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
  });
  it("leaves plain negative numbers alone", () => {
    expect(csvCell("-5")).toBe('"-5"');
    expect(csvCell("-1,200.50")).toBe('"-1,200.50"');
  });
  it("doubles embedded quotes and keeps newlines inside the quoted field", () => {
    expect(csvCell('say "hi"\nthere')).toBe('"say ""hi""\nthere"');
  });
  it("renders null/undefined as empty", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
  it("keeps formatted money, percent and the lone dash intact (same exemptions as DataTable csvSafe)", () => {
    expect(csvCell("-₹1,234.00")).toBe('"-₹1,234.00"');
    expect(csvCell("-5%")).toBe('"-5%"');
    expect(csvCell("-")).toBe('"-"');
    expect(csvCell("-$ 12.5")).toBe('"-$ 12.5"');
    expect(csvCell("-₹x")).toBe(`"'-₹x"`);
  });
});
