/**
 * FN-27 — Appeal & Grievance linkage.
 * FN-28 — RTI / Transparency hooks.
 *
 * BRD acceptance (FN-27): a Certificate service can offer an appeal path.
 * BRD acceptance (FN-28): "enabled service appears in RTI service list export",
 * with PII redacted from the exported summary.
 */
import { describe, it, expect } from "vitest";
import {
  appealEligibility,
  assertAppealLinkage,
  assertRtiLinkage,
  isPiiFieldName,
  rtiCatalogueEntry,
  PackLinkageError,
  type AppealLinkage,
  type RtiLinkage,
} from "./pack-linkage.js";
import { eventPermissionManifestBlocks } from "./manifests/event-permission.js";

const APPELLATE = "dsg-appellate-authority";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const APPEALABLE: AppealLinkage = {
  appealable: true,
  filingWindowDays: 30,
  appellateDesignationId: APPELLATE,
  appellateDesignationLabel: "Appellate Authority",
  statutoryReference: "s.21, Municipal Act",
};

/* ───────────────────────────── FN-27 ───────────────────────────── */

describe("FN-27 appealEligibility", () => {
  const DECIDED = d("2026-06-01");

  it("opens an appeal path on a decided certificate service", () => {
    const r = appealEligibility(APPEALABLE, DECIDED, d("2026-06-10"));
    expect(r.state).toBe("open");
    expect(r.filingDeadline).toBe("2026-07-01");
    expect(r.reason).toContain("2026-07-01");
  });

  it("allows filing on the deadline day itself", () => {
    // The appeal module treats the deadline day as in-window; the pack layer
    // must not quietly tighten a statutory window.
    expect(appealEligibility(APPEALABLE, DECIDED, d("2026-07-01")).state).toBe("open");
  });

  it("closes the day after the deadline and still quotes the date", () => {
    const r = appealEligibility(APPEALABLE, DECIDED, d("2026-07-02"));
    expect(r.state).toBe("window_expired");
    expect(r.filingDeadline).toBe("2026-07-01");
    expect(r.reason).toContain("2026-07-01");
    expect(r.reason).toContain("30-day");
  });

  it("quotes the same deadline whether the window is open or closed", () => {
    const open = appealEligibility(APPEALABLE, DECIDED, d("2026-06-02"));
    const shut = appealEligibility(APPEALABLE, DECIDED, d("2026-09-01"));
    // A drifting deadline between the two branches would be a real citizen-facing bug.
    expect(shut.filingDeadline).toBe(open.filingDeadline);
  });

  it("falls back to the appeal module's default window", () => {
    const noWindow: AppealLinkage = { ...APPEALABLE };
    delete noWindow.filingWindowDays;
    const r = appealEligibility(noWindow, DECIDED, d("2026-06-10"));
    expect(r.filingDeadline).toBe("2026-07-01"); // DEFAULT_FILING_WINDOW_DAYS = 30
  });

  it("honours a pack-specific window that is not the default", () => {
    const r = appealEligibility({ ...APPEALABLE, filingWindowDays: 60 }, DECIDED, d("2026-07-15"));
    expect(r.state).toBe("open");
    expect(r.filingDeadline).toBe("2026-07-31");
  });

  it("reports not_appealable when the pack offers no appeal path", () => {
    for (const linkage of [null, undefined, { ...APPEALABLE, appealable: false }]) {
      const r = appealEligibility(linkage, DECIDED, d("2026-06-10"));
      expect(r.state).toBe("not_appealable");
      expect(r.filingDeadline).toBeUndefined();
    }
  });

  it("is date-based — time of day does not decide the outcome", () => {
    expect(appealEligibility(APPEALABLE, DECIDED, new Date("2026-07-01T23:59:59Z")).state).toBe("open");
  });
});

describe("FN-27 assertAppealLinkage — publish gate", () => {
  it("accepts an absent linkage", () => {
    expect(() => assertAppealLinkage(null)).not.toThrow();
    expect(() => assertAppealLinkage(undefined)).not.toThrow();
  });

  it("accepts appeals switched off with nothing else configured", () => {
    expect(() => assertAppealLinkage({ appealable: false })).not.toThrow();
  });

  it("rejects a non-object", () => {
    expect(() => assertAppealLinkage("yes")).toThrow(PackLinkageError);
  });

  it("rejects a missing or non-boolean appealable flag", () => {
    expect(() => assertAppealLinkage({})).toThrow(/MISSING_APPEALABLE/);
    expect(() => assertAppealLinkage({ appealable: "true" })).toThrow(/MISSING_APPEALABLE/);
  });

  it("rejects an appealable service with no appellate designation", () => {
    // An appeal right with nobody to hear it is a dead end for the citizen.
    expect(() => assertAppealLinkage({ appealable: true })).toThrow(/MISSING_APPELLATE_DESIGNATION/);
    expect(() => assertAppealLinkage({ appealable: true, appellateDesignationId: "  " })).toThrow(
      /MISSING_APPELLATE_DESIGNATION/,
    );
  });

  it("rejects a nonsensical filing window", () => {
    for (const bad of [0, -30, 30.5]) {
      expect(() =>
        assertAppealLinkage({ ...APPEALABLE, filingWindowDays: bad }),
      ).toThrow(/BAD_FILING_WINDOW/);
    }
  });

  it("accepts a well-formed appealable linkage", () => {
    expect(() => assertAppealLinkage(APPEALABLE)).not.toThrow();
  });
});

/* ───────────────────────────── FN-28 ───────────────────────────── */

const PUBLISHED: RtiLinkage = {
  published: true,
  pioDesignationId: "dsg-pio",
  pioDesignationLabel: "Public Information Officer",
};

describe("FN-28 rtiCatalogueEntry", () => {
  const blocks = eventPermissionManifestBlocks();
  const service = {
    serviceKey: "pack:event-permission",
    name: "Event Permission",
    servicePattern: "certificate",
    blocks,
  };

  it("BRD acceptance: an enabled service appears in the RTI export", () => {
    const entry = rtiCatalogueEntry(PUBLISHED, service);
    expect(entry).not.toBeNull();
    expect(entry?.serviceKey).toBe("pack:event-permission");
    expect(entry?.name).toBe("Event Permission");
    expect(entry?.pattern).toBe("certificate");
    expect(entry?.slaDays).toBe(blocks.slaDays);
    expect(entry?.pioDesignationLabel).toBe("Public Information Officer");
  });

  it("omits a service that is not published to RTI", () => {
    expect(rtiCatalogueEntry(null, service)).toBeNull();
    expect(rtiCatalogueEntry(undefined, service)).toBeNull();
    expect(rtiCatalogueEntry({ published: false }, service)).toBeNull();
  });

  it("exports document *types*, never applicant answers", () => {
    const entry = rtiCatalogueEntry(PUBLISHED, service);
    expect(entry?.requiredDocumentTypes).toEqual((blocks.requiredDocuments ?? []).map((x) => x.docType));
    expect(entry?.requiredDocumentTypes.length).toBeGreaterThan(0);
  });

  it("carries no key outside the declared metadata allow-list", () => {
    // This is the actual redaction guarantee: the entry is assembled field by
    // field, so a new pack block cannot silently start appearing in a public
    // export. If this assertion ever needs relaxing, the new key must be
    // reviewed for PII first.
    const entry = rtiCatalogueEntry(PUBLISHED, service)!;
    expect(Object.keys(entry).sort()).toEqual(
      [
        "channels",
        "description",
        "feeCurrency",
        "feeFromMinor",
        "name",
        "pattern",
        "pioDesignationLabel",
        "requiredDocumentTypes",
        "serviceKey",
        "slaDays",
      ].sort(),
    );
  });

  it("does not leak form fields even when handed a pack full of them", () => {
    const entry = rtiCatalogueEntry(PUBLISHED, service)!;
    const serialised = JSON.stringify(entry);
    const apiNames = (blocks.forms ?? []).flatMap((f) =>
      Object.values(f.formDesign.fields).map((x) => x.apiName),
    );
    const piiNames = apiNames.filter(isPiiFieldName);
    expect(piiNames.length).toBeGreaterThan(0); // otherwise this test proves nothing
    for (const apiName of piiNames) {
      expect(serialised).not.toContain(apiName);
    }
  });

  it("copies the channel list rather than aliasing the pack's array", () => {
    const base = eventPermissionManifestBlocks();
    const entry = rtiCatalogueEntry(PUBLISHED, { ...service, blocks: base })!;
    entry.channels.push("smoke-signal");
    expect(base.channels).not.toContain("smoke-signal");
  });

  it("survives a service with no blocks at all", () => {
    const entry = rtiCatalogueEntry(PUBLISHED, { serviceKey: "k", name: "n" });
    expect(entry?.channels).toEqual([]);
    expect(entry?.requiredDocumentTypes).toEqual([]);
    expect(entry?.pattern).toBeUndefined();
  });
});

describe("FN-28 isPiiFieldName", () => {
  it("flags applicant-identifying field names", () => {
    for (const n of [
      "applicantName", "mobileNumber", "email", "permanentAddress",
      "aadhaarNumber", "panNumber", "dateOfBirth", "gender",
      "photograph", "signature", "bankAccountNumber", "ifscCode", "passportNo",
    ]) {
      expect(isPiiFieldName(n)).toBe(true);
    }
  });

  it("does not flag service-descriptive field names", () => {
    for (const n of ["eventType", "venue", "ward", "expectedAttendance", "hallId", "slotStart"]) {
      expect(isPiiFieldName(n)).toBe(false);
    }
  });

  it("is case-insensitive and null-safe", () => {
    expect(isPiiFieldName("APPLICANT_NAME")).toBe(true);
    expect(isPiiFieldName(undefined as unknown as string)).toBe(false);
  });
});

describe("FN-28 assertRtiLinkage — publish gate", () => {
  it("accepts an absent linkage or an unpublished service", () => {
    expect(() => assertRtiLinkage(null)).not.toThrow();
    expect(() => assertRtiLinkage({ published: false })).not.toThrow();
  });

  it("rejects a non-object or a missing published flag", () => {
    expect(() => assertRtiLinkage(42)).toThrow(PackLinkageError);
    expect(() => assertRtiLinkage({})).toThrow(/MISSING_PUBLISHED/);
  });

  it("rejects publishing to the RTI catalogue with no PIO to receive requests", () => {
    expect(() => assertRtiLinkage({ published: true })).toThrow(/MISSING_PIO_DESIGNATION/);
    expect(() => assertRtiLinkage({ published: true, pioDesignationId: " " })).toThrow(/MISSING_PIO_DESIGNATION/);
  });

  it("accepts a well-formed published linkage", () => {
    expect(() => assertRtiLinkage(PUBLISHED)).not.toThrow();
  });
});
