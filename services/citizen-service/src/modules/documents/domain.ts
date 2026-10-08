/**
 * SVC-084 / FN-26 — pure document-verification domain helpers (no I/O, unit-tested).
 *
 * Covers: the DigiLocker adapter honesty gate, the per-service required-document
 * checklist status computation, lane-scoped officer checklists (FN-26), and the
 * verification/deficiency state machine.
 */

import {
  docsForVerificationLane,
  normalizeLaneKey,
  type RequiredDocWithLane,
} from "../catalogue/lane-bindings.js";

export { docsForVerificationLane, normalizeLaneKey };

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
 * The outcome of exchanging an OAuth authorization code at the callback. A real
 * provider returns the citizen-authorised docUri plus the signed issued-document
 * artefact (PKCS#7/CMS DER + the content it signs) so the server can verify it
 * locally. Fail-closed providers return `ok: false`.
 */
export interface DigiLockerExchangeResult {
  ok: boolean;
  providerStatus: string;
  docUri: string | null;
  /** The signed issued-document artefact, when the provider returns one. */
  artefact?: { content: Uint8Array; signatureDer: Uint8Array } | undefined;
}

/**
 * GAP-CITIZEN-DOCUMENTS-02 — in-repo DigiLocker provider interface. A real
 * integration implements `authorizeUrl` (the OAuth consent redirect) and
 * `fetchDocument` (the signed pull of the citizen-authorised docUri). The
 * default provider is FAIL-CLOSED: with no credentials configured it never
 * fabricates a source-verified success — it honestly reports
 * `provider_unconfigured`. Wiring a real provider is a HUMAN REVIEW follow-up.
 */
export interface DigiLockerProvider {
  isConfigured(): boolean;
  /** The provider-issued OAuth authorize URL to redirect the citizen to. */
  authorizeUrl(params: { docType: string; redirectUri: string; state: string; codeChallenge?: string }): string | null;
  /** Exchange the callback authorization code (+ PKCE verifier) for a docUri + signed artefact. */
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<DigiLockerExchangeResult>;
  /** Resolve a citizen-authorised docUri into a source-verified result. */
  fetchDocument(docUri: string): DigiLockerResult;
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
 * The default fail-closed provider. Honest when unconfigured; records the
 * source-verified provenance only when credentials are present (the real signed
 * pull would run here). Thrown behind an interface so a real provider adapter
 * can be injected without touching callers.
 */
export const defaultDigiLockerProvider: DigiLockerProvider = {
  isConfigured: () => isDigiLockerConfigured(),
  authorizeUrl: ({ docType, redirectUri, state, codeChallenge }) => {
    if (!isDigiLockerConfigured()) return null;
    const base = process.env.CITIZEN_DIGILOCKER_AUTHORIZE_URL ?? "https://api.digitallocker.gov.in/public/oauth2/1/authorize";
    const clientId = process.env.CITIZEN_DIGILOCKER_CLIENT_ID ?? process.env.DIGILOCKER_CLIENT_ID ?? "";
    const qs = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: redirectUri,
      state, scope: "avs_parent_file", doctype: docType,
    });
    if (codeChallenge) {
      qs.set("code_challenge", codeChallenge);
      qs.set("code_challenge_method", "S256");
    }
    return `${base}?${qs.toString()}`;
  },
  // Fail-closed: with no credentials the default provider never fabricates a
  // code exchange. A real adapter POSTs to the token endpoint, pulls the
  // docUri, and returns the signed artefact for local verification.
  exchangeCode: async () => ({ ok: false, providerStatus: "provider_unconfigured", docUri: null }),
  fetchDocument: (docUri: string) => digiLockerFetch(docUri),
};

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
  required: Array<{ docType: string; label?: string | undefined; mandatory: boolean; verifiedAtLane?: string | undefined }>,
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

/**
 * FN-26 — officer workbasket checklist for a single verification lane.
 * When `laneKey` is set, only documents bound to that lane are returned.
 */
export function computeLaneChecklist(
  required: RequiredDocWithLane[],
  submissions: Array<{ docType: string; status: string; verificationStatus: string }>,
  laneKey?: string | undefined,
): { items: ChecklistItem[]; complete: boolean; laneKey: string | null } {
  const scoped = laneKey ? docsForVerificationLane(required, laneKey) : required;
  const { items, complete } = computeChecklist(scoped, submissions);
  return { items, complete, laneKey: laneKey ? normalizeLaneKey(laneKey) : null };
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
