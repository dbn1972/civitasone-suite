/**
 * CRM Documents — alert domain tests (missing mandatory, expiring docs).
 * Pack #12. Source: modules/documents/alert-domain.ts
 */
import { describe, it, expect } from "vitest";
import { findMissingMandatory, findExpiringDocuments } from "../src/modules/documents/alert-domain.js";

describe("findMissingMandatory", () => {
  it("returns missing codes for subjects without the required doc", () => {
    const result = findMissingMandatory("account", ["kyc", "pan_card"], [
      { subjectId: "a1", docTypeCodes: ["kyc"] },        // missing pan_card
      { subjectId: "a2", docTypeCodes: ["kyc", "pan_card"] }, // complete
    ]);
    expect(result).toEqual([{ subjectType: "account", subjectId: "a1", docTypeCode: "pan_card" }]);
  });

  it("returns all missing for a subject with no docs", () => {
    const result = findMissingMandatory("contact", ["id_proof", "address_proof"], [
      { subjectId: "c1", docTypeCodes: [] },
    ]);
    expect(result.length).toBe(2);
  });

  it("returns empty when no mandatory codes", () => {
    expect(findMissingMandatory("account", [], [{ subjectId: "a1", docTypeCodes: [] }])).toEqual([]);
  });

  it("deduplicates mandatory codes", () => {
    const result = findMissingMandatory("x", ["kyc", "kyc"], [{ subjectId: "s1", docTypeCodes: [] }]);
    expect(result.length).toBe(1);
  });
});

describe("findExpiringDocuments", () => {
  const NOW = new Date("2026-07-15T12:00:00Z");

  it("finds already expired documents", () => {
    const docs = [{ documentId: "d1", subjectType: "account", subjectId: "a1", docTypeCode: "kyc", expiryDate: "2026-07-01" }];
    const result = findExpiringDocuments(docs, NOW, 30);
    expect(result.length).toBe(1);
    expect(result[0]!.expired).toBe(true);
    expect(result[0]!.daysUntilExpiry).toBeLessThan(0);
  });

  it("finds documents expiring within N days", () => {
    const docs = [{ documentId: "d1", subjectType: "contact", subjectId: "c1", docTypeCode: "id", expiryDate: "2026-08-01" }];
    const result = findExpiringDocuments(docs, NOW, 30);
    expect(result.length).toBe(1);
    expect(result[0]!.expired).toBe(false);
    expect(result[0]!.daysUntilExpiry).toBeGreaterThanOrEqual(0);
  });

  it("excludes documents expiring beyond the horizon", () => {
    const docs = [{ documentId: "d1", subjectType: "x", subjectId: "x1", docTypeCode: "y", expiryDate: "2027-01-01" }];
    const result = findExpiringDocuments(docs, NOW, 30);
    expect(result.length).toBe(0);
  });

  it("skips null expiryDate", () => {
    const docs = [{ documentId: "d1", subjectType: "x", subjectId: "x1", docTypeCode: "y", expiryDate: null }];
    expect(findExpiringDocuments(docs, NOW, 365).length).toBe(0);
  });

  // GAP-CRM-DOCUMENTS-05: the Documents page copy states expiry is flagged
  // "within 30 days (configurable)". Pin the 30-day boundary so the copy and
  // the behaviour stay in agreement: a doc exactly 30 days out is included, one
  // 31 days out is not. (The scheduler's default horizon is 30 — see
  // alert-scheduler.ts expiryHorizonDays(): CRM_DOC_EXPIRY_ALERT_DAYS ?? 30.)
  it("includes a doc exactly 30 days out and excludes one 31 days out (30-day UI claim)", () => {
    const at30 = [{ documentId: "d30", subjectType: "contact", subjectId: "c1", docTypeCode: "kyc", expiryDate: "2026-08-14" }];
    const at31 = [{ documentId: "d31", subjectType: "contact", subjectId: "c1", docTypeCode: "kyc", expiryDate: "2026-08-15" }];
    expect(findExpiringDocuments(at30, NOW, 30).length).toBe(1);
    expect(findExpiringDocuments(at31, NOW, 30).length).toBe(0);
  });
});
