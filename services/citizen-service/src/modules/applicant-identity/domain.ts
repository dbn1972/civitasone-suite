/**
 * FN-23 — Applicant Identity Types (pure domain, no I/O).
 *
 * Service designers configure which applicant profiles may apply
 * (citizen | company | institution | anonymous). Anonymous is Grievance-only.
 * Profile attribute registry bindings declare which identity attributes are
 * collected / required per allowed type.
 */

export const APPLICANT_TYPES = ["citizen", "company", "institution", "anonymous"] as const;
export type ApplicantType = (typeof APPLICANT_TYPES)[number];

/** BRD aliases accepted at intake boundaries (normalised to ApplicantType). */
const APPLICANT_TYPE_ALIASES: Record<string, ApplicantType> = {
  citizen: "citizen",
  individual: "citizen",
  person: "citizen",
  company: "company",
  org: "company",
  organisation: "company",
  organization: "company",
  institution: "institution",
  institutional: "institution",
  anonymous: "anonymous",
  anon: "anonymous",
};

export const DEFAULT_ALLOWED_APPLICANT_TYPES: ApplicantType[] = ["citizen"];

export const DEFAULT_APPLICANT_TYPE_REJECT_MESSAGE =
  "This service does not accept applications from your applicant type.";

export interface ProfileAttributeDef {
  key: string;
  label: string;
  /** Types that may bind this attribute. */
  applicantTypes: ApplicantType[];
  dataType: "text" | "date" | "email" | "phone" | "id";
}

/** Platform profile attribute registry (designer picker source). */
export const PROFILE_ATTRIBUTE_REGISTRY: readonly ProfileAttributeDef[] = [
  { key: "fullName", label: "Full name", applicantTypes: ["citizen", "anonymous"], dataType: "text" },
  { key: "dateOfBirth", label: "Date of birth", applicantTypes: ["citizen"], dataType: "date" },
  { key: "mobile", label: "Mobile", applicantTypes: ["citizen", "company", "institution", "anonymous"], dataType: "phone" },
  { key: "email", label: "Email", applicantTypes: ["citizen", "company", "institution"], dataType: "email" },
  { key: "aadhaarLast4", label: "Aadhaar (last 4)", applicantTypes: ["citizen"], dataType: "id" },
  { key: "pan", label: "PAN", applicantTypes: ["citizen", "company"], dataType: "id" },
  { key: "gstin", label: "GSTIN", applicantTypes: ["company"], dataType: "id" },
  { key: "cin", label: "CIN", applicantTypes: ["company"], dataType: "id" },
  { key: "orgName", label: "Organisation name", applicantTypes: ["company", "institution"], dataType: "text" },
  { key: "registrationNo", label: "Registration number", applicantTypes: ["institution"], dataType: "id" },
  { key: "ward", label: "Ward / zone", applicantTypes: ["citizen", "company", "institution"], dataType: "text" },
] as const;

export interface ProfileAttributeBinding {
  attributeKey: string;
  applicantType: ApplicantType;
  required: boolean;
}

export function isApplicantType(value: unknown): value is ApplicantType {
  return typeof value === "string" && (APPLICANT_TYPES as readonly string[]).includes(value);
}

/** Map intake aliases (e.g. individual → citizen) onto the canonical enum. */
export function normalizeApplicantType(raw: unknown): ApplicantType | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return APPLICANT_TYPE_ALIASES[key] ?? null;
}

export function attributesForTypes(types: readonly ApplicantType[]): ProfileAttributeDef[] {
  const set = new Set(types);
  return PROFILE_ATTRIBUTE_REGISTRY.filter((a) => a.applicantTypes.some((t) => set.has(t)));
}

/**
 * Structural validation of allowed types for a service pattern.
 * Anonymous is Grievance-only (FN-23).
 */
export function assertAllowedApplicantTypesConfig(
  allowed: unknown,
  servicePattern: string | null | undefined,
): asserts allowed is ApplicantType[] {
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new Error("APPLICANT_TYPES_EMPTY");
  }
  const seen = new Set<string>();
  for (const t of allowed) {
    if (!isApplicantType(t)) throw new Error(`APPLICANT_TYPE_BAD: ${String(t)}`);
    if (seen.has(t)) throw new Error(`APPLICANT_TYPE_DUPLICATE: ${t}`);
    seen.add(t);
    if (t === "anonymous" && servicePattern !== "grievance") {
      throw new Error("ANONYMOUS_GRIEVANCE_ONLY");
    }
  }
}

export function assertProfileAttributeBindings(
  bindings: unknown,
  allowed: readonly ApplicantType[],
): asserts bindings is ProfileAttributeBinding[] {
  if (!Array.isArray(bindings)) throw new Error("PROFILE_BINDINGS_NOT_ARRAY");
  const allowedSet = new Set(allowed);
  const registryKeys = new Set(PROFILE_ATTRIBUTE_REGISTRY.map((a) => a.key));
  const seen = new Set<string>();
  for (const b of bindings as ProfileAttributeBinding[]) {
    if (!b || typeof b !== "object") throw new Error("PROFILE_BINDING_BAD");
    if (typeof b.attributeKey !== "string" || !registryKeys.has(b.attributeKey)) {
      throw new Error(`PROFILE_ATTR_UNKNOWN: ${String(b?.attributeKey)}`);
    }
    if (!isApplicantType(b.applicantType) || !allowedSet.has(b.applicantType)) {
      throw new Error(`PROFILE_ATTR_TYPE_NOT_ALLOWED: ${String(b.applicantType)}`);
    }
    const def = PROFILE_ATTRIBUTE_REGISTRY.find((a) => a.key === b.attributeKey)!;
    if (!def.applicantTypes.includes(b.applicantType)) {
      throw new Error(`PROFILE_ATTR_TYPE_MISMATCH: ${b.attributeKey}/${b.applicantType}`);
    }
    if (typeof b.required !== "boolean") throw new Error("PROFILE_BINDING_REQUIRED_BOOL");
    const sig = `${b.applicantType}:${b.attributeKey}`;
    if (seen.has(sig)) throw new Error(`PROFILE_BINDING_DUPLICATE: ${sig}`);
    seen.add(sig);
  }
}

export interface ApplicantTypeGateInput {
  allowedApplicantTypes: readonly ApplicantType[];
  applicantType: ApplicantType;
  rejectMessage?: string | null | undefined;
}

export class ApplicantTypeRejectedError extends Error {
  readonly code = "APPLICANT_TYPE_NOT_ALLOWED";
  readonly rejectMessage: string;
  constructor(message: string) {
    super(message);
    this.name = "ApplicantTypeRejectedError";
    this.rejectMessage = message;
  }
}

/**
 * Runtime gate: company-only (etc.) services reject mismatched profiles with
 * the designer-configured message (FN-23 acceptance).
 */
export function assertApplicantTypeAllowed(input: ApplicantTypeGateInput): void {
  const allowed = input.allowedApplicantTypes;
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new ApplicantTypeRejectedError(DEFAULT_APPLICANT_TYPE_REJECT_MESSAGE);
  }
  if (!allowed.includes(input.applicantType)) {
    const msg =
      typeof input.rejectMessage === "string" && input.rejectMessage.trim().length > 0
        ? input.rejectMessage.trim()
        : DEFAULT_APPLICANT_TYPE_REJECT_MESSAGE;
    throw new ApplicantTypeRejectedError(msg);
  }
}

/** Defaults when a legacy definition has no FN-23 columns yet. */
export function coerceAllowedApplicantTypes(raw: unknown): ApplicantType[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_ALLOWED_APPLICANT_TYPES];
  const out: ApplicantType[] = [];
  for (const item of raw) {
    const n = normalizeApplicantType(item) ?? (isApplicantType(item) ? item : null);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.length > 0 ? out : [...DEFAULT_ALLOWED_APPLICANT_TYPES];
}
