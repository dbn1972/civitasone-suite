import { describe, it, expect } from "vitest";
import { mapAssetSummaries, mapAssetDetail, parseMinorString } from "./apiMappers";

const row = (over: Record<string, unknown>) => ({ id: "a1", name: "Laptop", code: "AST-1", acquisitionCost: "100000", bookValue: "80000", ...over });
const status = (s: string) => mapAssetSummaries({ data: [row({ status: s })] })![0]!.status;

describe("mapAssetSummaries status (GAP-ASSETS-DETAIL-05)", () => {
  it("keeps written_off instead of folding it into active", () => {
    expect(status("written_off")).toBe("written_off");
  });
  it("maps the service's under_maintenance to maintenance", () => {
    expect(status("under_maintenance")).toBe("maintenance");
    expect(status("maintenance")).toBe("maintenance");
  });
  it("keeps disposed / condemned / in_use and defaults the rest to active", () => {
    expect(status("disposed")).toBe("disposed");
    expect(status("condemned")).toBe("condemned");
    expect(status("in_use")).toBe("in_use");
    expect(status("transferred")).toBe("active");
  });
});

// GAP-ASSETS-LIST-04: an unrecognised status is shown as unknown, never folded into active
describe("mapAssetSummaries status (GAP-ASSETS-LIST-04)", () => {
  it("keeps lost and scrapped instead of reading them as active", () => {
    expect(status("lost")).toBe("lost");
    expect(status("scrapped")).toBe("scrapped");
  });
  it("surfaces an unrecognised or missing-enum status as unknown (a missing status stays the old active default)", () => {
    expect(status("quarantined")).toBe("unknown");
    expect(status("under_repair")).toBe("unknown");
    expect(mapAssetSummaries({ data: [{ id: "a1", name: "N", code: "C" }] })![0]!.status).toBe("active");
  });
  it("is case-insensitive", () => {
    expect(status("WRITTEN_OFF")).toBe("written_off");
    expect(status("Under_Maintenance")).toBe("maintenance");
  });
});

describe("locationId (GAP-ASSETS-LOCATIONS-03)", () => {
  it("carries the registered location id and omits it when absent", () => {
    expect(mapAssetSummaries({ data: [row({ locationId: "loc-1", location: "Block A" })] })![0]).toMatchObject({ locationId: "loc-1", location: "Block A" });
    expect(mapAssetSummaries({ data: [row({ locationId: null })] })![0]).not.toHaveProperty("locationId");
  });
});

describe("barcode (GAP-ASSETS-FIXED-ASSETS-03 / DETAIL-08)", () => {
  it("maps a real barcode and omits the field when there is none", () => {
    expect(mapAssetSummaries({ data: [row({ barcode: "AST-1-BC" })] })![0]!.barcode).toBe("AST-1-BC");
    expect(mapAssetSummaries({ data: [row({ barcode: null })] })![0]).not.toHaveProperty("barcode");
  });
  it("does not turn the barcode into the serial number", () => {
    const d = mapAssetDetail(row({ barcode: "AST-1-BC" }))!;
    expect(d.barcode).toBe("AST-1-BC");
    expect(d.serialNo).toBeUndefined();
    expect(mapAssetDetail(row({ serialNo: "SN-9" }))!.serialNo).toBe("SN-9");
  });
});

describe("parseMinorString (GAP-ASSETS-DASHBOARD-03)", () => {
  it("returns exact digit strings and strips leading zeros", () => {
    expect(parseMinorString("9000000000000001")).toBe("9000000000000001");
    expect(parseMinorString("000123")).toBe("123");
    expect(parseMinorString("0")).toBe("0");
    expect(parseMinorString(12345)).toBe("12345");
  });
  it("rejects fractions, negatives, unsafe numbers and junk", () => {
    for (const bad of ["12.5", "-1", "abc", "", null, undefined, 1.5, -3, 2 ** 53 + 2, Number.NaN]) expect(parseMinorString(bad)).toBeNull();
  });
});
