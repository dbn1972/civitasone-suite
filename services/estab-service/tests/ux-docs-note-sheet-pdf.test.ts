/** UAT ux-docs: the note sheet embeds the Devanagari-capable font, so a Hindi noting prints. */
import { describe, it, expect } from "vitest";
import { pdfText, pdfFlatText, pdfFonts, isPdf } from "@civitasone/render/testing";
import { buildNoteSheetPdf } from "../src/modules/files/note-sheet-print/routes.js";
import type { FileDetailDto } from "../src/modules/files/queries.js";

const AT = new Date("2026-11-04T07:00:00.000Z");

describe("note sheet PDF", () => {
  it("prints the file, a Hindi noting and IST dates with an embedded font", async () => {
    const file = {
      id: "f1", fileNo: "CON/2026/005375", subject: "Procurement of desktops", dept: "Administration", dakNo: null, dueBy: "2026-11-18T06:00:00.000Z",
      noteSheets: [
        { author: "Meena Iyer, Section Officer", content: "प्रस्ताव अनुमोदन हेतु प्रस्तुत है।", noteType: "yellow", noteStatus: "submitted" },
        { author: "Asha Rao, Under Secretary", content: "Approved.", noteType: "green", noteStatus: "approved", eSigned: true, signatureRef: "DSC-1" },
      ],
    } as unknown as FileDetailDto;
    const bytes = await buildNoteSheetPdf(file, "Digital India Corporation", AT);
    expect(isPdf(bytes)).toBe(true);
    const text = await pdfText(bytes);
    const flat = await pdfFlatText(bytes);
    expect(flat).toContain("File No CON/2026/005375");
    expect(flat).toContain("SLA Due 18 Nov 2026");
    expect(flat).toContain("Meena Iyer, Section Officer");
    expect(flat).toContain("Approved.");
    expect(flat).toContain("DSC: DSC-1");
    expect((text.match(/[ऀ-ॿ]/g) ?? []).length).toBeGreaterThan(10);
    const fonts = await pdfFonts(bytes);
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });
});
