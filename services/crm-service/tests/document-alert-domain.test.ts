/**
 * DM-002 — pure alert-domain maths: missing-mandatory + expiring/expired.
 */
import { describe, it, expect } from "vitest";
import {
  findMissingMandatory,
  findExpiringDocuments,
} from "../src/modules/documents/alert-domain.js";

describe("DM-002 findMissingMandatory", () => {
  it("flags every mandatory code a subject lacks", () => {
    const out = findMissingMandatory("contact", ["pan", "gst"], [
      { subjectId: "s1", docTypeCodes: ["pan"] },
      { subjectId: "s2", docTypeCodes: [] },
      { subjectId: "s3", docTypeCodes: ["pan", "gst"] },
    ]);
    expect(out).toEqual([
      { subjectType: "contact", subjectId: "s1", docTypeCode: "gst" },
      { subjectType: "contact", subjectId: "s2", docTypeCode: "pan" },
      { subjectType: "contact", subjectId: "s2", docTypeCode: "gst" },
    ]);
  });

  it("returns nothing when there are no mandatory codes", () => {
    expect(findMissingMandatory("contact", [], [{ subjectId: "s1", docTypeCodes: [] }])).toEqual([]);
  });

  it("de-duplicates repeated mandatory codes", () => {
    const out = findMissingMandatory("account", ["pan", "pan"], [{ subjectId: "s1", docTypeCodes: [] }]);
    expect(out).toEqual([{ subjectType: "account", subjectId: "s1", docTypeCode: "pan" }]);
  });
});

describe("DM-002 findExpiringDocuments", () => {
  const now = new Date("2026-08-05T12:00:00Z");
  const doc = (id: string, expiryDate: string | null) => ({
    documentId: id, subjectType: "contact", subjectId: "s1", docTypeCode: "pan", expiryDate,
  });

  it("includes documents already expired (negative days) and marks them expired", () => {
    const [r] = findExpiringDocuments([doc("d1", "2026-08-01")], now, 30);
    expect(r.expired).toBe(true);
    expect(r.daysUntilExpiry).toBeLessThan(0);
  });

  it("includes documents expiring within the horizon", () => {
    const out = findExpiringDocuments([doc("d1", "2026-08-20")], now, 30);
    expect(out).toHaveLength(1);
    expect(out[0].expired).toBe(false);
    expect(out[0].daysUntilExpiry).toBe(15);
  });

  it("excludes documents beyond the horizon", () => {
    expect(findExpiringDocuments([doc("d1", "2026-12-01")], now, 30)).toEqual([]);
  });

  it("ignores rows without an expiry date", () => {
    expect(findExpiringDocuments([doc("d1", null)], now, 30)).toEqual([]);
  });

  it("treats a negative horizon as zero (expired-only) and excludes future docs", () => {
    const out = findExpiringDocuments([doc("d1", "2026-08-20"), doc("d2", "2026-08-04")], now, -5);
    expect(out.map((r) => r.documentId)).toEqual(["d2"]);
  });
});
