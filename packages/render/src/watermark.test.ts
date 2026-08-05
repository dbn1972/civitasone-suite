import { describe, it, expect } from "vitest";
import { applyPdfWatermark, applyXlsxWatermark, applyCsvWatermark } from "./watermark.js";
import ExcelJS from "exceljs";

describe("applyPdfWatermark", () => {
  it("makes the PDF buffer larger after watermark (html-only mode)", () => {
    const html = "<html><body><h1>Report</h1></body></html>";
    const original = Buffer.from(html, "utf-8");
    const result = applyPdfWatermark(original, { text: "CONFIDENTIAL" });
    expect(result.length).toBeGreaterThan(original.length);
  });

  it("includes watermark text in html-only output", () => {
    const html = "<html><body><h1>Report</h1></body></html>";
    const original = Buffer.from(html, "utf-8");
    const result = applyPdfWatermark(original, { text: "DRAFT COPY" });
    const output = result.toString("utf-8");
    expect(output).toContain("DRAFT COPY");
    expect(output).toContain("Report"); // original content preserved
  });

  it("applies watermark to a real PDF buffer (makes it larger)", () => {
    // Minimal PDF-like buffer with %PDF- header
    const fakePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    const result = applyPdfWatermark(fakePdf, { text: "TOP SECRET" });
    expect(result.length).toBeGreaterThan(fakePdf.length);
    expect(result.toString("ascii")).toContain("TOP SECRET");
  });

  it("respects opacity and angle options", () => {
    const html = "<p>test</p>";
    const original = Buffer.from(html, "utf-8");
    const result = applyPdfWatermark(original, { text: "TEST", opacity: 0.3, angle: 30 });
    const output = result.toString("utf-8");
    expect(output).toContain("0.3");
    expect(output).toContain("30");
  });

  it("uses default opacity and angle when not specified", () => {
    const html = "<p>test</p>";
    const original = Buffer.from(html, "utf-8");
    const result = applyPdfWatermark(original, { text: "DEFAULT" });
    const output = result.toString("utf-8");
    expect(output).toContain("0.15"); // default opacity
  });

  it("escapes HTML special characters in watermark text", () => {
    const html = "<p>test</p>";
    const original = Buffer.from(html, "utf-8");
    const result = applyPdfWatermark(original, { text: "<script>alert('xss')</script>" });
    const output = result.toString("utf-8");
    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;");
  });
});

describe("applyXlsxWatermark", () => {
  it("adds watermark as first row in XLSX", async () => {
    // Create a minimal XLSX buffer
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    sheet.addRow(["Name", "Value"]);
    sheet.addRow(["Item A", 100]);
    const originalBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await applyXlsxWatermark(originalBuffer, "CONFIDENTIAL — Test Tenant");

    // Parse result and verify first row
    const resultWorkbook = new ExcelJS.Workbook();
    await resultWorkbook.xlsx.load(result as unknown as ArrayBuffer);
    const resultSheet = resultWorkbook.worksheets[0]!;
    const firstRow = resultSheet.getRow(1);
    expect(firstRow.getCell(1).value).toBe("CONFIDENTIAL — Test Tenant");
  });

  it("produces a valid XLSX (starts with PK zip header)", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Sheet1").addRow(["col1"]);
    const originalBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await applyXlsxWatermark(originalBuffer, "WATERMARK");
    expect(result[0]).toBe(0x50); // P
    expect(result[1]).toBe(0x4b); // K
  });

  it("applies watermark to all worksheets", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Sheet1").addRow(["A"]);
    workbook.addWorksheet("Sheet2").addRow(["B"]);
    const originalBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await applyXlsxWatermark(originalBuffer, "MULTI-SHEET WM");

    const resultWorkbook = new ExcelJS.Workbook();
    await resultWorkbook.xlsx.load(result as unknown as ArrayBuffer);
    for (const ws of resultWorkbook.worksheets) {
      expect(ws.getRow(1).getCell(1).value).toBe("MULTI-SHEET WM");
    }
  });
});

describe("applyCsvWatermark", () => {
  it("prepends a comment line with watermark text", () => {
    const csv = "Name,Value\nAlpha,100\nBeta,200";
    const result = applyCsvWatermark(csv, "CONFIDENTIAL — 2026-07-15");
    const lines = result.split("\n");
    expect(lines[0]).toBe("# CONFIDENTIAL — 2026-07-15");
    expect(lines[1]).toBe("Name,Value");
  });

  it("preserves original CSV content", () => {
    const csv = "A,B\n1,2";
    const result = applyCsvWatermark(csv, "WM");
    expect(result).toContain("A,B\n1,2");
  });

  it("starts with # comment marker", () => {
    const result = applyCsvWatermark("col\nval", "test");
    expect(result.startsWith("# ")).toBe(true);
  });
});
