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
    // GAP-ASSETS-BULK-IMPORT-04: a reason is mandatory before a GL-linked mass load.
    const confirmBtn = screen.getAllByRole("button", { name: "Import 1 asset" }).at(-1)!;
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason / authority for this load"), { target: { value: "FY26 opening register, order 12/2026" } });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.assets[0]).toMatchObject({ name: "Chair, executive", acquisitionCostMinor: 4500000 });
    expect(body.reason).toBe("FY26 opening register, order 12/2026");
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/\S{8,}/);
  });

  it("blocks import and lists line-numbered errors when any row is invalid", () => {
    render(<BulkImportPage />);
    fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: "Laptop,LAP/1,it,45000\nDesk,FUR/2,movable,abc" } });
    expect(screen.getByText(/Line 2: cost "abc" is not a valid rupee amount/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 asset" })).toBeDisabled();
  });
});

describe("bulk import validation, preview and errors (ml-assets-01)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  // GAP-ASSETS-BULK-IMPORT-03
  it("flags a repeated code on the later line and blocks the import", () => {
    const { rows, errors, preview } = parseAssetCsv("Laptop,LAP/1,it,100\nDesk,FUR/2,movable,100\nLaptop 2,lap/1,it,100");
    expect(rows.map((r) => r.code)).toEqual(["LAP/1", "FUR/2"]);
    expect(errors).toEqual([{ line: 3, message: 'code "lap/1" is already used on line 1' }]);
    expect(preview.map((p) => p.error === null)).toEqual([true, true, false]);
    expect(isImportable({ rows, errors, preview })).toBe(false);
  });

  it("renders a per-row preview with a verdict for every line before anything is sent", () => {
    render(<BulkImportPage />);
    fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: "Laptop,LAP/1,it,100\nDesk,FUR/2,gadget,100" } });
    const table = screen.getByRole("table", { name: "Import preview" });
    const rowsText = Array.from(table.querySelectorAll("tbody tr")).map((r) => r.textContent);
    expect(rowsText[0]).toMatch(/LAP\/1.*Ready/);
    expect(rowsText[1]).toMatch(/FUR\/2.*Error/);
    expect(screen.getByText(/Line 2: assetType must be one of/)).toBeInTheDocument();
  });

  async function submitValid() {
    render(<BulkImportPage />);
    fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: "Laptop,LAP/1,it,100" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 asset" }));
    await waitFor(() => expect(screen.getByText("Import these assets?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authority for this load"), { target: { value: "order 1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Import 1 asset" }).at(-1)!);
  }

  // GAP-ASSETS-BULK-IMPORT-05
  it("shows plain copy, not the raw response body, when the server fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"code":"INTERNAL","message":"ECONNRESET at pg pool 10.0.0.5"}', { status: 500 }));
    await submitValid();
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/ECONNRESET/)).not.toBeInTheDocument();
  });

  it("names the clashing codes when the server answers 409 DUPLICATE_CODE", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"code":"DUPLICATE_CODE","message":"asset code(s) already in the register: LAP/1"}', { status: 409 }),
    );
    await submitValid();
    await waitFor(() => expect(screen.getByText(/Some asset codes are already in use: LAP\/1/)).toBeInTheDocument());
  });

  it("reuses one Idempotency-Key when the same CSV is retried", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await submitValid();
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Import 1 asset" }).at(-1)!);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const key = (i: number) => ((spy.mock.calls[i]![1] as RequestInit).headers as Record<string, string>)["x-idempotency-key"];
    expect(key(0)).toMatch(/\S{8,}/);
    expect(key(1)).toBe(key(0));
  });
});
