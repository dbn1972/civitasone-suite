import { describe, it, expect } from "vitest";
import {
  applyMergeSample,
  cellChipLabel,
  disableCell,
  enableCell,
  eventsForPattern,
  seedMatrixForPattern,
  smsSegmentCount,
  smsStats,
} from "./notificationTypes";

describe("notificationTypes", () => {
  it("counts SMS segments", () => {
    expect(smsSegmentCount("")).toBe(0);
    expect(smsSegmentCount("x".repeat(160))).toBe(1);
    expect(smsSegmentCount("x".repeat(161))).toBe(2);
  });

  it("warns when SMS exceeds one segment", () => {
    const stats = smsStats("x".repeat(161));
    expect(stats.segments).toBe(2);
    expect(stats.warn).toMatch(/Longer than one SMS/);
  });

  it("seeds matrix with defaults for certificate pattern", () => {
    const matrix = seedMatrixForPattern("certificate");
    expect(matrix.submitted?.sms?.enabled).toBe(true);
    expect(matrix.payment_due?.whatsapp?.enabled).toBe(true);
    expect(matrix.inspection_scheduled?.sms?.enabled).toBe(true);
  });

  it("seeds grievance without payment_due defaults and with closure wording", () => {
    const matrix = seedMatrixForPattern("grievance");
    expect(eventsForPattern("grievance")).not.toContain("payment_due");
    expect(matrix.payment_due?.sms?.enabled).toBeUndefined();
    expect(matrix.approved?.sms?.body.en).toMatch(/grievance/i);
    expect(matrix.issued?.in_app?.body.en).toMatch(/Closure note/i);
  });

  it("seeds collection without approval / inspection defaults", () => {
    const matrix = seedMatrixForPattern("collection");
    expect(matrix.approved?.sms?.enabled).toBeUndefined();
    expect(matrix.payment_due?.sms?.enabled).toBe(true);
    expect(matrix.payment_received?.email?.enabled).toBe(true);
  });

  it("labels cells Off vs On · Edit and enable/disable without losing body", () => {
    const matrix = seedMatrixForPattern("certificate");
    expect(cellChipLabel(undefined)).toBe("Off");
    expect(cellChipLabel(matrix.submitted?.sms)).toMatch(/Application submitted|On/);

    const off = disableCell(matrix, "submitted", "sms");
    expect(off.submitted?.sms?.enabled).toBe(false);
    expect(off.submitted?.sms?.body.en).toBeTruthy();
    expect(cellChipLabel(off.submitted?.sms)).toBe("Off");

    const on = enableCell(off, "submitted", "sms");
    expect(on.submitted?.sms?.enabled).toBe(true);
    expect(on.submitted?.sms?.body.en).toBe(matrix.submitted?.sms?.body.en);
  });

  it("applies merge sample values and keeps unknown tokens as pills", () => {
    expect(applyMergeSample("Hi {{applicant_name}} — {{missing}}", { applicant_name: "Asha" })).toBe(
      "Hi Asha — ⟨missing⟩",
    );
  });
});
