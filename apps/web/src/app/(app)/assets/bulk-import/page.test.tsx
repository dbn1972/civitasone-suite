import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BulkImportPage from "./page";
import { isImportable, parseAssetCsv } from "./parseAssetCsv";

describe("parseAssetCsv (GAP-ASSETS-BULK-IMPORT-02)", () => {
  it("keeps a quoted name with a comma as one field and parses a quoted '45,000' to paise", () => {
    const { rows, errors } = parseAssetCsv('name,code,assetType,cost,orgUnit\n"Chair, executive",FUR/1,movable,"45,000",HQ');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ name: "Chair, executive", code: "FUR/1", assetType: "movable", acquisitionCostMinor: 4500000, orgUnit: "HQ" }]);
  });

  it("keeps row 1 when there is no header", () => {
    const { rows } = parseAssetCsv("Laptop,LAP/1,it,45000.50,HQ\nDesk,FUR/2,movable,₹ 1200,");
    expect(rows.map((r) => r.code)).toEqual(["LAP/1", "FUR/2"]);
    expect(rows[0]!.acquisitionCostMinor).toBe(4500050);
    expect(rows[1]!.acquisitionCostMinor).toBe(120000);
    expect(rows[1]!.orgUnit).toBeUndefined();
  });

  it("reports an invalid cost with its line number instead of sending null", () => {
    const { rows, errors } = parseAssetCsv("name,code,assetType,cost\nLaptop,LAP/1,it,abc\nDesk,FUR/2,movable,10.555");
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
    expect(errors[0]!.message).toMatch(/not a valid rupee amount/);
  });

  it("flags an unquoted comma that shifts columns and an unknown asset type", () => {
    const { errors } = parseAssetCsv("Chair, executive,FUR/1,movable,100,HQ\nLaptop,LAP/1,gadget,100");
    expect(errors[0]).toMatchObject({ line: 1 });
    expect(errors[0]!.message).toMatch(/expected 5 columns/);
    expect(errors[1]!.message).toMatch(/assetType must be one of/);
  });

  it("isImportable needs rows and no errors", () => {
    expect(isImportable(parseAssetCsv(""))).toBe(false);
    expect(isImportable(parseAssetCsv("Laptop,LAP/1,it,100"))).toBe(true);
    expect(isImportable(parseAssetCsv("Laptop,LAP/1,it,100\nDesk,F/1,movable,abc"))).toBe(false);
  });

  it("handles CRLF and escaped quotes", () => {
    const { rows } = parseAssetCsv('"Desk ""L"" shape",FUR/9,movable,100\r\n');
    expect(rows[0]!.name).toBe('Desk "L" shape');
  });
});

describe("BulkImportPage (GAP-ASSETS-BULK-IMPORT-01/02)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("loads with an empty textarea and a disabled Import button", () => {
    render(<BulkImportPage />);
    expect(screen.getByLabelText("CSV data")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Import 0 assets/ })).toBeDisabled();
  });

  it("enables Import for valid rows and posts paise amounts after confirm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<BulkImportPage />);
    fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: '"Chair, executive",FUR/1,movable,"45,000",HQ' } });
    const btn = screen.getByRole("button", { name: "Import 1 asset" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("Import these assets?")).toBeInTheDocument());
    expect(screen.getByText("₹45,000.00")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Import 1 asset" }).at(-1)!);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.assets[0]).toMatchObject({ name: "Chair, executive", acquisitionCostMinor: 4500000 });
  });

  it("blocks import and lists line-numbered errors when any row is invalid", () => {
    render(<BulkImportPage />);
    fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: "Laptop,LAP/1,it,45000\nDesk,FUR/2,movable,abc" } });
    expect(screen.getByText(/Line 2: cost "abc" is not a valid rupee amount/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 asset" })).toBeDisabled();
  });
});
