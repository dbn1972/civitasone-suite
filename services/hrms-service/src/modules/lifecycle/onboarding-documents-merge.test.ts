/**
 * mergeOnboardingDocuments — unit tests (COMP-015).
 *
 * Regression cover for: `hr/onboarding/[id]` used to render the SAME 6
 * hardcoded documents, all permanently "pending", for every employee
 * (DEFAULT_DOCUMENTS in apps/web's page.tsx) — no per-employee state, no way
 * for a document to ever show as received/verified for anyone.
 *
 * This is a pure function (config catalogue x this-employee's-own rows in,
 * merged checklist out) with no DB/queue involved, so it is tested directly
 * rather than through the route or the F3 consumer — see
 * onboarding-routes.ts's own comment on why the tenant-wide summary route's
 * equivalent merge logic has never had a dedicated test file in this module;
 * this one gets one because it is new logic this gap fix introduces, not
 * pre-existing behavior.
 */
import { describe, it, expect } from "vitest";
import { mergeOnboardingDocuments, DEFAULT_DOC_CATALOGUE } from "./onboarding-routes.js";

const CONFIG = [
  { docType: "appointment_letter", required: true },
  { docType: "pan_card", required: true },
];

describe("mergeOnboardingDocuments", () => {
  it("defaults every configured document to pending when the employee has taken no action yet", () => {
    const merged = mergeOnboardingDocuments(CONFIG, []);
    expect(merged).toHaveLength(2);
    for (const doc of merged) {
      expect(doc.status).toBe("pending");
      expect(doc.receivedAt).toBeNull();
      expect(doc.verifiedBy).toBeNull();
      expect(doc.verifiedAt).toBeNull();
    }
    // Real, not fabricated: it's driven by the config catalogue passed in,
    // not a hardcoded English string baked into this function.
    expect(merged.map((d) => d.docType)).toEqual(["appointment_letter", "pan_card"]);
  });

  it("reflects this employee's own real status for a document they acted on, leaving the rest pending", () => {
    const merged = mergeOnboardingDocuments(CONFIG, [
      { docType: "pan_card", status: "verified", receivedAt: "2026-08-01T00:00:00Z", verifiedBy: "hr-1", verifiedAt: "2026-08-02T00:00:00Z" },
    ]);
    const appt = merged.find((d) => d.docType === "appointment_letter")!;
    const pan = merged.find((d) => d.docType === "pan_card")!;
    expect(appt.status).toBe("pending");
    expect(pan.status).toBe("verified");
    expect(pan.verifiedBy).toBe("hr-1");
    expect(pan.receivedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(pan.verifiedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("produces genuinely different output for two employees with different real rows -- the COMP-015 regression", () => {
    const employeeA = mergeOnboardingDocuments(CONFIG, []);
    const employeeB = mergeOnboardingDocuments(CONFIG, [
      { docType: "appointment_letter", status: "uploaded", receivedAt: "2026-08-01T00:00:00Z", verifiedBy: null, verifiedAt: null },
      { docType: "pan_card", status: "rejected", receivedAt: "2026-08-01T00:00:00Z", verifiedBy: "hr-2", verifiedAt: "2026-08-03T00:00:00Z" },
    ]);
    expect(employeeA).not.toEqual(employeeB);
    expect(employeeA.every((d) => d.status === "pending")).toBe(true);
    expect(employeeB.find((d) => d.docType === "appointment_letter")!.status).toBe("uploaded");
    expect(employeeB.find((d) => d.docType === "pan_card")!.status).toBe("rejected");
  });

  it("falls back to the platform default catalogue when the tenant has configured no document types for this employeeType", () => {
    const merged = mergeOnboardingDocuments([], []);
    expect(merged.map((d) => d.docType)).toEqual(DEFAULT_DOC_CATALOGUE.map((d) => d.docType));
    expect(merged.every((d) => d.status === "pending")).toBe(true);
  });

  it("always sources `required` from the tenant's config, never from the employee's own row", () => {
    const merged = mergeOnboardingDocuments(
      [{ docType: "pan_card", required: false }],
      [{ docType: "pan_card", status: "verified", receivedAt: null, verifiedBy: "hr-1", verifiedAt: null }],
    );
    expect(merged[0]!.required).toBe(false);
  });
});
