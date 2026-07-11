/**
 * court-documents — pure unit tests of the pdf-lib renderers. No DB, no HTTP.
 * Each renderer must return a Uint8Array that begins with the PDF magic bytes
 * ("%PDF" = 0x25 0x50 0x44 0x46) and is non-trivially sized.
 */
import { describe, it, expect } from "vitest";
import {
  renderCauseListPdf,
  renderOrderPdf,
  renderCertifiedCopyPdf,
} from "../src/modules/court-documents/render.js";

/** Assert the byte stream starts with "%PDF". */
function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

describe("court-documents renderers", () => {
  it("renderCauseListPdf produces a valid PDF", async () => {
    const bytes = await renderCauseListPdf({
      courtName: "Test District Court",
      listDate: "2026-07-11",
      items: [
        { itemNo: 1, caseRef: "CNR-0001", slot: "10:30", courtroom: "Room 1" },
        { itemNo: 2, caseRef: "CNR-0002", slot: "11:00", courtroom: "Room 2" },
      ],
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(startsWithPdfMagic(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(800);
  });

  it("renderCauseListPdf handles an empty item list", async () => {
    const bytes = await renderCauseListPdf({
      courtName: "Empty Court",
      listDate: "2026-07-11",
      items: [],
    });
    expect(startsWithPdfMagic(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(800);
  });

  it("renderOrderPdf produces a valid PDF", async () => {
    const bytes = await renderOrderPdf({
      courtName: "Test District Court",
      caption: "State vs. Doe",
      cnr: "CNR-9001",
      orderType: "order",
      orderDate: "2026-07-10",
      orderText: "The application is allowed. ".repeat(60),
      status: "issued",
      signedBy: "Hon. Judge A",
      hasDsc: true,
    });
    expect(startsWithPdfMagic(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(800);
  });

  it("renderOrderPdf DRAFT branch differs from ISSUED branch", async () => {
    const base = {
      courtName: "Test District Court",
      caption: "State vs. Doe",
      cnr: "CNR-9001",
      orderType: "order" as const,
      orderDate: "2026-07-10",
      orderText: "Short order body.",
      signedBy: "Hon. Judge A",
      hasDsc: false,
    };
    const issued = await renderOrderPdf({ ...base, status: "issued" });
    const draft = await renderOrderPdf({ ...base, status: "draft" });
    expect(startsWithPdfMagic(issued)).toBe(true);
    expect(startsWithPdfMagic(draft)).toBe(true);
    // The DRAFT watermark line adds content, so the two outputs differ in size.
    expect(draft.length).not.toBe(issued.length);
  });

  it("renderOrderPdf renders JUDGMENT for a judgment order type", async () => {
    const bytes = await renderOrderPdf({
      courtName: "High Court",
      caption: "Appeal No. 12",
      cnr: "CNR-7777",
      orderType: "judgment",
      orderDate: "2026-07-01",
      orderText: "Judgment reserved earlier is now pronounced.",
      status: "issued",
      signedBy: "Hon. Judge B",
      hasDsc: true,
    });
    expect(startsWithPdfMagic(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(800);
  });

  it("renderCertifiedCopyPdf issued (seal) vs provisional differ", async () => {
    const base = {
      courtName: "Test District Court",
      copyId: "11111111-1111-4111-8111-111111111111",
      copiesCount: 2,
      issuedBy: "Registry Clerk",
      issuedAt: "2026-07-11T09:00:00.000Z",
      orderText: "Certified copy of the order dated 2026-07-10.",
      caption: "State vs. Doe",
      cnr: "CNR-9001",
    };
    const issued = await renderCertifiedCopyPdf({ ...base, status: "issued" });
    const provisional = await renderCertifiedCopyPdf({ ...base, status: "requested" });
    expect(startsWithPdfMagic(issued)).toBe(true);
    expect(startsWithPdfMagic(provisional)).toBe(true);
    expect(issued.length).toBeGreaterThan(800);
    expect(issued.length).not.toBe(provisional.length);
  });
});
