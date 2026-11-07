/** UAT ux-docs: the service book is a real PDF naming the employee and the officers, IST dates. */
import { describe, it, expect } from "vitest";
import { pdfFlatText, pdfFonts, isPdf } from "@civitasone/render/testing";
import { EMPTY_DOC_IDENTITY } from "@civitasone/render/official";
import { renderServiceBookPdf } from "../src/modules/service-book/pdf-routes.js";

const AT = new Date("2026-11-04T07:00:00.000Z");

describe("service book PDF", () => {
  it("prints the employee by name and every entry with who recorded / attested it", async () => {
    const bytes = await renderServiceBookPdf({
      employee: { name: "Asha Verma", employeeNo: "EMP-001", designation: "Section Officer", department: "Administration", joiningDate: "2019-07-01", status: "active" },
      entries: [
        { effectiveDate: "2019-07-01", entryType: "appointment", description: "Appointed as Assistant Section Officer", documentRef: "F.No. A-12011/1/2019", recordedBy: { name: "Meena Iyer", designation: "Section Officer (Estt.)" }, attested: true, attestedBy: { name: "Asha Rao", designation: "Under Secretary" }, attestedAt: "2019-07-02T05:00:00.000Z" },
        { effectiveDate: "2024-07-01", entryType: "promotion", description: "Promoted to Section Officer", documentRef: null, recordedBy: null, attested: false, attestedBy: null, attestedAt: null },
      ],
    }, { ...EMPTY_DOC_IDENTITY, orgName: "Digital India Corporation" }, AT);
    expect(isPdf(bytes)).toBe(true);
    const flat = await pdfFlatText(bytes);
    for (const s of ["Service Book", "Name Asha Verma", "Employee No EMP-001", "Designation Section Officer", "Date of joining 01 Jul 2019",
      "01 Jul 2019 Appointment Appointed as Assistant Section Officer", "Recorded: Meena Iyer", "Attested: Asha Rao, Under Secretary on 02 Jul 2019",
      "Promoted to Section Officer", "Not yet attested"]) {
      expect(flat).toContain(s);
    }
    expect(flat).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    const fonts = await pdfFonts(bytes);
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });
});
