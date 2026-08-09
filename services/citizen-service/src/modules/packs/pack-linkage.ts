/**
 * FN-27 (Appeal & Grievance linkage) + FN-28 (RTI / Transparency hooks).
 * Pure domain, no I/O.
 *
 * Both FNs are described in the BRD as pack-level *linkage config* over modules
 * that already exist — appeal, grievance and rti all ship their own domain logic.
 * So this module deliberately does not reimplement filing windows or deadlines:
 * FN-27 delegates to appeal/domain.ts's assertWithinFilingWindow, which already
 * encodes the "filing on the deadline day is allowed" rule. Duplicating that
 * would create two statutory clocks that could drift apart.
 */

import {
  DEFAULT_FILING_WINDOW_DAYS,
  addDays,
  assertWithinFilingWindow,
  toDateString,
} from "../appeal/domain.js";

/* ───────────────────────── FN-27 — Appeal linkage ───────────────────────── */

export interface AppealLinkage {
  /** Whether a decision on this service can be appealed at all. */
  appealable: boolean;
  /** Statutory filing window in days; falls back to the appeal module default. */
  filingWindowDays?: number | undefined;
  /** Designation that hears the appeal (not a named person — FN-05 rule). */
  appellateDesignationId?: string | undefined;
  appellateDesignationLabel?: string | undefined;
  /** Act/section the appeal right derives from, surfaced to the citizen. */
  statutoryReference?: string | undefined;
}

export type AppealAvailability = "not_appealable" | "open" | "window_expired";

export interface AppealEligibility {
  state: AppealAvailability;
  filingDeadline?: string | undefined;
  reason: string;
}

/**
 * May a decision issued on `decisionDate` still be appealed as at `now`?
 *
 * `now` is injected so sandbox runs and tests are deterministic.
 */
export function appealEligibility(
  linkage: AppealLinkage | null | undefined,
  decisionDate: Date,
  now: Date,
): AppealEligibility {
  if (!linkage?.appealable) {
    return {
      state: "not_appealable",
      reason: "This decision does not carry a right of appeal through this service.",
    };
  }

  const windowDays = linkage.filingWindowDays ?? DEFAULT_FILING_WINDOW_DAYS;
  try {
    const { filingDeadline } = assertWithinFilingWindow(decisionDate, windowDays, now);
    return {
      state: "open",
      filingDeadline,
      reason: `You may appeal this decision until ${filingDeadline}.`,
    };
  } catch {
    // assertWithinFilingWindow throws FILING_WINDOW_EXPIRED without carrying the
    // deadline. Recompute it with the appeal module's own addDays so the date we
    // quote to the citizen is the same one it enforced — not a parallel arithmetic.
    const deadline = toDateString(addDays(decisionDate, windowDays));
    return {
      state: "window_expired",
      filingDeadline: deadline,
      reason: `The ${windowDays}-day window to appeal closed on ${deadline}.`,
    };
  }
}

export class PackLinkageError extends Error {}

/** Publish gate for FN-27 config. */
export function assertAppealLinkage(linkage: unknown): asserts linkage is AppealLinkage | null | undefined {
  if (linkage == null) return;
  if (typeof linkage !== "object") throw new PackLinkageError("APPEAL_LINKAGE_NOT_AN_OBJECT");
  const l = linkage as AppealLinkage;

  if (typeof l.appealable !== "boolean") throw new PackLinkageError("APPEAL_LINKAGE_MISSING_APPEALABLE");
  if (!l.appealable) return; // nothing else is meaningful when appeals are off

  if (l.filingWindowDays !== undefined) {
    if (!Number.isInteger(l.filingWindowDays) || l.filingWindowDays <= 0) {
      throw new PackLinkageError("APPEAL_BAD_FILING_WINDOW");
    }
  }
  // An appealable decision with nobody to hear it is a dead end for the citizen.
  if (!l.appellateDesignationId || String(l.appellateDesignationId).trim().length === 0) {
    throw new PackLinkageError("APPEAL_MISSING_APPELLATE_DESIGNATION");
  }
}

/* ─────────────────────── FN-28 — RTI / transparency ─────────────────────── */

export interface RtiLinkage {
  /** Designer toggle: publish this service's metadata to the RTI catalogue. */
  published: boolean;
  /** Public information officer designation for this service. */
  pioDesignationId?: string | undefined;
  pioDesignationLabel?: string | undefined;
}

export interface RtiCatalogueEntry {
  serviceKey: string;
  name: string;
  description?: string | undefined;
  pattern?: string | undefined;
  slaDays?: number | undefined;
  feeFromMinor?: number | undefined;
  feeCurrency?: string | undefined;
  channels: string[];
  /** Document *types* required — never applicant-supplied values. */
  requiredDocumentTypes: string[];
  pioDesignationLabel?: string | undefined;
}

/**
 * Field-name fragments that mark an applicant-identifying answer.
 * Matched case-insensitively against form field api names.
 */
const PII_FRAGMENTS = [
  "name", "mobile", "phone", "email", "address", "aadhaar", "aadhar", "pan",
  "dob", "birth", "gender", "photo", "signature", "account", "ifsc", "passport",
];

/** True when a form field's api name looks like applicant PII. */
export function isPiiFieldName(apiName: string): boolean {
  const n = String(apiName ?? "").toLowerCase();
  return PII_FRAGMENTS.some((frag) => n.includes(frag));
}

/**
 * Build the RTI catalogue entry for a published service.
 *
 * BRD: "auto-redact PII in exported summaries." The redaction here is
 * structural rather than a scrub of free text: the entry is assembled from an
 * allow-list of service *metadata* only. No form answers, no applicant fields
 * and no document contents can reach it, because none of them are read. That is
 * a stronger guarantee than filtering a wide object would give, since a new
 * field added to a pack cannot silently start leaking.
 *
 * Returns null when the service is not published to RTI.
 */
export function rtiCatalogueEntry(
  linkage: RtiLinkage | null | undefined,
  service: {
    serviceKey: string;
    name: string;
    servicePattern?: string | null;
    blocks?: {
      description?: string | undefined;
      slaDays?: number | undefined;
      feeFromMinor?: number | undefined;
      feeCurrency?: string | undefined;
      channels?: string[] | undefined;
      requiredDocuments?: readonly { docType: string }[] | undefined;
    };
  },
): RtiCatalogueEntry | null {
  if (!linkage?.published) return null;

  const b = service.blocks ?? {};
  return {
    serviceKey: service.serviceKey,
    name: service.name,
    description: b.description,
    pattern: service.servicePattern ?? undefined,
    slaDays: b.slaDays,
    feeFromMinor: b.feeFromMinor,
    feeCurrency: b.feeCurrency,
    channels: [...(b.channels ?? [])],
    requiredDocumentTypes: (b.requiredDocuments ?? []).map((d) => d.docType),
    pioDesignationLabel: linkage.pioDesignationLabel,
  };
}

/** Publish gate for FN-28 config. */
export function assertRtiLinkage(linkage: unknown): asserts linkage is RtiLinkage | null | undefined {
  if (linkage == null) return;
  if (typeof linkage !== "object") throw new PackLinkageError("RTI_LINKAGE_NOT_AN_OBJECT");
  const l = linkage as RtiLinkage;

  if (typeof l.published !== "boolean") throw new PackLinkageError("RTI_LINKAGE_MISSING_PUBLISHED");
  if (!l.published) return;
  // RTI Act requires a named PIO per public authority; publishing a service to
  // the RTI catalogue with no officer to receive requests is not compliant.
  if (!l.pioDesignationId || String(l.pioDesignationId).trim().length === 0) {
    throw new PackLinkageError("RTI_MISSING_PIO_DESIGNATION");
  }
}
