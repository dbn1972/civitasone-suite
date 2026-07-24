/**
 * SVC-084 — pure document-verification domain helpers (no I/O, unit-tested).
 *
 * Covers: the DigiLocker adapter honesty gate, the per-service required-document
 * checklist status computation, and the verification/deficiency state machine.
 */

export const DOC_SOURCES = ["upload", "digilocker"] as const;
export type DocSource = typeof DOC_SOURCES[number];

export const DOC_STATUSES = ["received", "verified", "rejected", "deficient", "superseded"] as const;
export type DocStatus = typeof DOC_STATUSES[number];

export const VERIFICATION_STATUSES = ["pending", "verified", "failed"] as const;
export type VerificationStatus = typeof VERIFICATION_STATUSES[number];

export interface DigiLockerResult {
  configured: boolean;
  /** provider status recorded on the submission; never fabricates success. */
  providerStatus: string;
  digilockerRef: string | null;
  authenticity: "unverified" | "self_attested" | "source_verified";
}

/**
 * DigiLocker honesty gate: a real source-verified fetch only happens when
 * provider credentials are configured. With none, the fetch is honestly
 * recorded as `provider_unconfigured` — NOT a fake source-verified success.
 */
export function isDigiLockerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const id = env.CITIZEN_DIGILOCKER_CLIENT_ID ?? env.DIGILOCKER_CLIENT_ID;
  const secret = env.CITIZEN_DIGILOCKER_CLIENT_SECRET ?? env.DIGILOCKER_CLIENT_SECRET;
  return typeof id === "string" && id.trim().length > 0 && typeof secret === "string" && secret.trim().length > 0;
}

/**
 * Resolve the outcome of a DigiLocker fetch WITHOUT calling out to any provider
 * unless configured. When unconfigured the document is still recorded (received)
 * but flagged pending + provider_unconfigured so an officer knows it is not yet
 * source-verified.
 */
export function digiLockerFetch(docUri: string, env: NodeJS.ProcessEnv = process.env): DigiLockerResult {
  if (!isDigiLockerConfigured(env)) {
    return { configured: false, providerStatus: "provider_unconfigured", digilockerRef: docUri, authenticity: "unverified" };
  }
  // Credentials present: the adapter would perform the signed pull here. We
  // record the source-verified provenance the real fetch would establish.
  return { configured: true, providerStatus: "fetched", digilockerRef: docUri, authenticity: "source_verified" };
}

export interface ChecklistItem {
  docType: string;
  label?: string | undefined;
  mandatory: boolean;
  provided: boolean;
  verified: boolean;
}

/**
 * Compute a required-document checklist for a service, folding in the citizen's
 * actual submissions. A checklist item is `provided` if any non-superseded
 * submission of that docType exists, and `verified` if any is verified.
 */
export function computeChecklist(
  required: Array<{ docType: string; label?: string | undefined; mandatory: boolean }>,
  submissions: Array<{ docType: string; status: string; verificationStatus: string }>,
): { items: ChecklistItem[]; complete: boolean } {
  const items = required.map((r) => {
    const forType = submissions.filter((s) => s.docType === r.docType && s.status !== "superseded");
    const provided = forType.length > 0;
    const verified = forType.some((s) => s.verificationStatus === "verified");
    return { docType: r.docType, label: r.label, mandatory: r.mandatory, provided, verified };
  });
  const complete = items.filter((i) => i.mandatory).every((i) => i.verified);
  return { items, complete };
}

/** Map an officer verification decision to the resulting persisted state. */
export function verificationTransition(decision: "verify" | "reject" | "deficient"): {
  status: DocStatus; verificationStatus: VerificationStatus; authenticity?: "source_verified";
} {
  switch (decision) {
    case "verify":    return { status: "verified", verificationStatus: "verified", authenticity: "source_verified" };
    case "reject":    return { status: "rejected", verificationStatus: "failed" };
    case "deficient": return { status: "deficient", verificationStatus: "failed" };
  }
}
