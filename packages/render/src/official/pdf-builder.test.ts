import { describe, it, expect } from "vitest";
import { OfficialPdf } from "./pdf-builder.js";
import { docFontFaceCss, DOC_FONT } from "./fonts.js";
import { pdfText, pdfFlatText, pdfFonts, pdfPages, isPdf } from "../testing.js";

const AT = new Date("2026-11-04T07:00:00.000Z");

async function sample(): Promise<Uint8Array> {
  const pdf = await OfficialPdf.create({ title: "Sample order", lang: "bilingual", footerNote: "Sample order SO/1", generatedAt: AT, watermark: "DRAFT" });
  pdf.letterhead({ orgNameHi: "भारत सरकार", orgName: "Government of India", ministry: "Ministry of Electronics and Information Technology", department: "Digital India Corporation", address: "Electronics Niketan, New Delhi" })
    .title("Sanction Order", "स्वीकृति आदेश")
    .refLine("No. SO/1", "Dated: 04 Nov 2026")
    .fields([{ label: "Amount", value: "₹ 12,345.00" }, { label: "PAN", value: "XXXXX1234X" }])
    .paragraph("Sanction is hereby accorded to an expenditure of ₹ 12,345.00 (Rupees Twelve Thousand Three Hundred Forty Five Only).")
    .table({ columns: [{ header: "Item", width: 3 }, { header: "Amount (₹)", width: 1, align: "right" }], rows: [["Desktop", "6,002.00"]], footRows: [["Total", "6,002.00"]] })
    .markdown("## Decisions\n- **Approved** the plan")
    .signatures([{ caption: "Sanctioning authority", name: "Asha Rao", designation: "Under Secretary" }]);
  return pdf.save();
}

describe("OfficialPdf", () => {
  it("produces a real A4 PDF with the text a viewer extracts", async () => {
    const bytes = await sample();
    expect(isPdf(bytes)).toBe(true);
    const pages = await pdfPages(bytes);
    expect(pages[0]?.width).toBeCloseTo(595.28, 1);
    expect(pages[0]?.height).toBeCloseTo(841.89, 1);
    const text = await pdfText(bytes);
    expect(text).toContain("Government of India");
    expect(text).toContain("No. SO/1");
    expect(text).toContain("Dated: 04 Nov 2026");
    expect(text).toContain("₹ 12,345.00");
    expect(await pdfFlatText(bytes)).toContain("(Rupees Twelve Thousand Three Hundred Forty Five Only).");
    expect(text).toContain("Desktop");
    expect(text).toContain("Decisions");
    expect(text).toContain("Approved the plan");
    expect(text).not.toContain("**");
    expect(text).toContain("(Asha Rao)");
    expect(text).toContain("Under Secretary");
    expect(text).toContain("Page 1 of 1");
    expect(text).toContain("Generated on 04 Nov 2026, 12:30 PM IST");
    expect(text).toMatch(/[ऀ-ॿ]/);
  });

  it("embeds Noto Sans Devanagari (Latin + Devanagari subsets) and no unembedded standard font", async () => {
    const fonts = await pdfFonts(await sample());
    const noto = fonts.filter((f) => f.baseFont.includes("NotoSansDevanagari"));
    expect(noto.length).toBeGreaterThanOrEqual(2);
    expect(noto.every((f) => f.embedded)).toBe(true);
    expect(fonts.every((f) => f.embedded)).toBe(true);
    expect(fonts.some((f) => /Helvetica|Arial/.test(f.baseFont))).toBe(false);
  });

  it("repeats the table header on a new page and numbers pages", async () => {
    const pdf = await OfficialPdf.create({ title: "Long", generatedAt: AT });
    pdf.table({ columns: [{ header: "S.No", width: 1 }, { header: "Entry", width: 5 }], rows: Array.from({ length: 80 }, (_, i) => [String(i + 1), `Entry ${i + 1}`]) });
    const bytes = await pdf.save();
    const text = await pdfText(bytes);
    expect((await pdfPages(bytes)).length).toBeGreaterThan(1);
    expect(text.match(/S\.No Entry/g)?.length ?? 0).toBeGreaterThan(1);
    expect(text).toContain("Entry 80");
    expect(text).toMatch(/Page 2 of \d/);
  });

  it("never prints a blank letterhead line or an unencodable glyph error", async () => {
    const pdf = await OfficialPdf.create({ title: "x", generatedAt: AT });
    pdf.letterhead({ orgName: null, ministry: "  " }).paragraph("Tick ✓ and emoji 🙂 degrade to ?");
    const text = await pdfText(await pdf.save());
    expect(text).toContain("Tick ? and emoji ? degrade to ?");
  });

  it("font CSS for Chromium-rendered documents inlines both subsets", () => {
    const css = docFontFaceCss();
    expect(css).toContain(`font-family:"${DOC_FONT.family}"`);
    expect((css.match(/@font-face/g) ?? []).length).toBe(4);
    expect(css).toContain("data:font/woff;base64,");
    expect(css).toContain("U+0900-097F");
  });
});
