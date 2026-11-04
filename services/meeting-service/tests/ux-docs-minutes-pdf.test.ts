/** UAT ux-docs: minutes print names and designations, rendered Markdown and IST times. */
import { describe, it, expect, afterAll } from "vitest";
import { closePdfRenderer } from "@civitasone/render";

// Issued minutes are real Chromium output (the suite default is html-only for storage tests).
const savedMode = process.env.RENDER_PDF_MODE;
process.env.RENDER_PDF_MODE = "playwright";
afterAll(async () => { await closePdfRenderer(); if (savedMode === undefined) delete process.env.RENDER_PDF_MODE; else process.env.RENDER_PDF_MODE = savedMode; });
import { pdfText, pdfFlatText, pdfFonts, isPdf, pdfjsPageLines } from "@civitasone/render/testing";
import { EMPTY_DOC_IDENTITY } from "@civitasone/render/official";
import { renderMinutesPdf, type MinutesDocModel } from "../src/modules/minutes/minutes-pdf.js";

const AT = new Date("2026-11-04T07:00:00.000Z");
const model: MinutesDocModel = {
  meetingNumber: "MTG/2026-27/027", title: "Purchase committee", scheduledAt: "2026-11-19T16:48:00.000Z", venue: "Committee Room 2",
  fileReference: "CON/2026/005375", status: "approved",
  content: "# Minutes\n\n## Attendance\n_No attendance recorded._\n\n## Decisions\n1. **Approved** the purchase of desktops.\n- Action: `Store officer` to raise the PO.",
  chair: { name: "Asha Rao", designation: "Joint Secretary" }, secretary: { name: "Meena Iyer", designation: "Section Officer" },
  draftedBy: { name: "Meena Iyer", designation: "Section Officer" }, approvedBy: { name: "Asha Rao", designation: "Joint Secretary" },
  approvedAt: "2026-11-20T05:00:00.000Z", dscSignerName: null, dscSignedAt: null,
};

describe("minutes PDF", () => {
  it("names, rendered Markdown and IST timestamps; no ids, no raw Markdown", async () => {
    const bytes = await renderMinutesPdf(model, { ...EMPTY_DOC_IDENTITY, orgName: "Digital India Corporation" }, AT);
    expect(isPdf(bytes)).toBe(true);
    const text = await pdfText(bytes);
    const flat = await pdfFlatText(bytes);
    expect(text).toContain("No. MTG/2026-27/027");
    expect(flat).toContain("Date and time 19 Nov 2026, 10:18 PM IST");
    expect(flat).toContain("Chairperson Asha Rao, Joint Secretary");
    expect(flat).toContain("Member secretary Meena Iyer, Section Officer");
    expect(flat).toContain("No attendance recorded.");
    expect(flat).toContain("1. Approved the purchase of desktops.");
    expect(flat).toContain("Action: Store officer to raise the PO.");
    expect(flat).toContain("(Meena Iyer) (Asha Rao)");
    expect(flat).toContain("20 Nov 2026, 10:30 AM IST");
    expect(text).not.toMatch(/^#|\*\*|`|_No attendance/m);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    expect(text).not.toContain("2026-11-19T16:48");
    expect((await pdfjsPageLines(bytes)).flat().join("")).not.toContain("DRAFT");
  });

  it("unapproved minutes carry a DRAFT watermark", async () => {
    const bytes = await renderMinutesPdf({ ...model, status: "draft", approvedBy: null, approvedAt: null }, EMPTY_DOC_IDENTITY, AT);
    const text = await pdfText(bytes);
    // the watermark is rotated text: read it with pdf.js, which follows the text direction
    expect((await pdfjsPageLines(bytes)).flat().join("")).toContain("DRAFT - NOT APPROVED");
    expect(text).toContain("For approval by");
  });

  it("embeds Noto Sans Devanagari", async () => {
    const fonts = await pdfFonts(await renderMinutesPdf(model, EMPTY_DOC_IDENTITY, AT));
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });
});
