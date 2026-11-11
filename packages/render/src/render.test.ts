import { describe, it, expect, beforeAll } from "vitest";
import { renderPdf } from "./pdf.js";
import { renderXlsx, renderCsv } from "./xlsx.js";

beforeAll(() => {
  // Force html-only mode for CI (no chromium needed)
  process.env.RENDER_PDF_MODE = "html-only";
});

describe("renderPdf", () => {
  it("renders HTML to a non-empty buffer", async () => {
    const result = await renderPdf({
      html: "<html><body><h1>Test Report</h1><p>Content here</p></body></html>",
    });
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.mode).toBe("html-only");
    expect(result.buffer.toString("utf-8")).toContain("Test Report");
  });

  it("respects format and landscape options", async () => {
    const result = await renderPdf({
      html: "<h1>Landscape A4</h1>",
      format: "A4",
      landscape: true,
    });
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("reports unsigned when DSC env vars unset", async () => {
    delete process.env.DSC_P12_PATH;
    const result = await renderPdf({ html: "<p>test</p>" });
    expect(result.signed).toBe(false);
  });
});

describe("renderXlsx", () => {
  it("produces a non-empty XLSX buffer", async () => {
    const result = await renderXlsx({
      columns: [
        { header: "Name", key: "name" },
        { header: "Amount (₹)", key: "amount", style: { numFmt: "#,##0.00" } },
      ],
      rows: [
        { name: "Budget Head A", amount: 125000.50 },
        { name: "Budget Head B", amount: 340000.00 },
      ],
      title: "Financial Report FY 2026-27",
      generatedAt: "2026-07-04T12:00:00Z",
    });
    expect(result.buffer.length).toBeGreaterThan(100);
    expect(result.rowCount).toBe(2);
    // XLSX files start with PK zip magic bytes
    expect(result.buffer[0]).toBe(0x50); // P
    expect(result.buffer[1]).toBe(0x4B); // K
  });

  it("handles empty rows", async () => {
    const result = await renderXlsx({
      columns: [{ header: "Col", key: "col" }],
      rows: [],
    });
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.rowCount).toBe(0);
  });
});

describe("renderCsv", () => {
  it("produces valid CSV with headers and rows", () => {
    const csv = renderCsv(
      [{ header: "Name", key: "name" }, { header: "Value", key: "val" }],
      [{ name: "Alpha", val: 100 }, { name: "Beta, Inc", val: 200 }],
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Name,Value");
    expect(lines[1]).toBe("Alpha,100");
    expect(lines[2]).toBe('"Beta, Inc",200'); // comma in value = quoted
  });

  it("neutralises spreadsheet formulas in text cells but leaves numbers alone (UAT b23)", () => {
    const csv = renderCsv(
      [{ header: "Name", key: "n" }, { header: "Net", key: "v" }],
      [
        { n: '=HYPERLINK("http://evil.example","Click")', v: -1500 },
        { n: "+91 98765 43210", v: "-1,500.00" },
        { n: "@SUM(A1)", v: 0 },
        { n: "Lakshmi Narayanan", v: 7 },
      ],
    );
    const lines = csv.split("\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil.example"",""Click"")",-1500`);
    expect(lines[2]).toBe("'+91 98765 43210,\"-1,500.00\"");
    expect(lines[3]).toBe("'@SUM(A1),0");
    expect(lines[4]).toBe("Lakshmi Narayanan,7");
  });

  it("escapes double quotes in values", () => {
    const csv = renderCsv(
      [{ header: "Desc", key: "d" }],
      [{ d: 'She said "hello"' }],
    );
    expect(csv).toContain('"She said ""hello"""');
  });
});
