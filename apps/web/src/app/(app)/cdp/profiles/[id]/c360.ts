/**
 * Pure helpers for the Customer 360 profile screen (P1-14).
 *
 * cdp-service holds a golden profile as a flat attribute bag plus an append-only
 * `sourceLineage` trail. A lineage entry may name the attribute keys that source
 * supplied; when it does, this module resolves each attribute back to the system
 * that last wrote it. Attribution is derived here rather than in the service so
 * the rule is visible and testable in one place.
 */
import type { CDPProfile, CDPProfileLineageEntry } from "@civitasone/types";

export interface AttributeSource {
  key: string;
  value: string;
  /** System of record for this attribute, or null when no lineage claims it. */
  source: string | null;
  sourceId: string | null;
  /** When that source supplied it, ISO 8601. */
  recordedAt: string | null;
}

/** Renders an attribute value for a table cell without collapsing meaningful shapes. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() === "" ? "—" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(displayValue).join(", ");
  return JSON.stringify(value);
}

/**
 * GAP-CDP-PROFILES-DETAIL-01: DPDP data-minimisation for the free-form attribute
 * bag. A golden profile's attributes can hold direct personal identifiers
 * (email, phone, Aadhaar, PAN, address, date of birth). The Customer 360
 * attribute table — and its CSV export — must not render these in full by
 * default. This classifies an attribute by its KEY name and returns a masked
 * form; non-sensitive keys (tier, segment, lifetime value, …) are shown as-is.
 *
 * The value shown IS the value exported (the page pre-formats the masked string
 * into the row), so the CSV can never leak a cleartext identifier. There is no
 * client-side "reveal" here on purpose: a real reveal must round-trip to a
 * server-audited endpoint, and cdp-service exposes no such endpoint for the
 * generic attribute bag today — a reveal control with no audit behind it is
 * worse than none (a false sense of logged access). Reveal is a backend-
 * dependent follow-up (see GAP-CDP-PROFILES-DETAIL-06 / HUMAN REVIEW).
 */
const SENSITIVE_ATTRIBUTE_KEYS: Record<string, "email" | "phone" | "pan" | "aadhaar" | "generic"> = {
  email: "email",
  phone: "phone",
  mobile: "phone",
  contact: "phone",
  pan: "pan",
  aadhaar: "aadhaar",
  aadhar: "aadhaar",
  uid: "aadhaar",
  dob: "generic",
  dateofbirth: "generic",
  address: "generic",
};

function maskGenericValue(value: string): string {
  const v = value.trim();
  if (v.length <= 2) return "••";
  if (v.length <= 6) return `${v[0]}${"•".repeat(v.length - 1)}`;
  return `${v.slice(0, 2)}${"•".repeat(Math.max(v.length - 4, 2))}${v.slice(-2)}`;
}

function maskEmailValue(value: string): string {
  const v = value.trim();
  const at = v.indexOf("@");
  if (at <= 0 || at === v.length - 1) return maskGenericValue(v);
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  return `${local[0]}***@${domain
    .split(".")
    .map((label) => (label ? `${label[0]}${"*".repeat(Math.max(label.length - 1, 1))}` : ""))
    .join(".")}`;
}

function maskPhoneValue(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "X".repeat(Math.max(digits.length, 4));
  return `${digits.slice(0, 2)}${"X".repeat(digits.length - 5)}${digits.slice(-3)}`;
}

function maskPanValue(value: string): string {
  const v = value.trim();
  if (v.length !== 10) return "*".repeat(Math.min(Math.max(v.length, 4), 10));
  return `${v.slice(0, 5)}****${v.slice(9)}`;
}

function maskAadhaarValue(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX";
  return `XXXX XXXX ${digits.slice(-4)}`;
}

/**
 * Mask a profile attribute for display, keyed by its attribute name. Returns
 * the already-rendered display string masked where the key is PII-sensitive.
 * `isSensitive` lets the caller flag the column (e.g. a lock glyph) without
 * re-deriving the classification.
 */
export function maskAttribute(key: string, rawValue: unknown): { value: string; sensitive: boolean } {
  const shown = displayValue(rawValue);
  if (shown === "—") return { value: shown, sensitive: false };
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const kind = SENSITIVE_ATTRIBUTE_KEYS[normalized];
  if (!kind) return { value: shown, sensitive: false };
  const str = typeof rawValue === "string" ? rawValue : shown;
  switch (kind) {
    case "email":
      return { value: maskEmailValue(str), sensitive: true };
    case "phone":
      return { value: maskPhoneValue(str), sensitive: true };
    case "pan":
      return { value: maskPanValue(str), sensitive: true };
    case "aadhaar":
      return { value: maskAadhaarValue(str), sensitive: true };
    default:
      return { value: maskGenericValue(str), sensitive: true };
  }
}

/**
 * Latest lineage entry that claims a given attribute key.
 *
 * "Latest" is by timestamp, with the later position in the append-only array
 * breaking a tie: two ingests inside the same millisecond are ordered by the
 * order they were accepted, which is the only ordering the trail actually
 * guarantees.
 */
function latestClaimFor(key: string, lineage: CDPProfileLineageEntry[]): CDPProfileLineageEntry | null {
  let best: CDPProfileLineageEntry | null = null;
  for (const entry of lineage) {
    if (!entry.attributes?.includes(key)) continue;
    if (best === null) {
      best = entry;
      continue;
    }
    // >= keeps the later array position on an exact timestamp tie.
    if (entry.timestamp >= best.timestamp) best = entry;
  }
  return best;
}

/**
 * Every attribute on the profile with the source that last supplied it.
 *
 * An attribute no lineage entry claims comes back with `source: null` rather
 * than being attributed to the profile's most recent ingest. Guessing there
 * would put a system's name against a value it never sent, which is exactly the
 * claim a data-quality dispute turns on.
 */
export function resolveAttributeSources(profile: Pick<CDPProfile, "attributes" | "sourceLineage">): AttributeSource[] {
  const lineage = profile.sourceLineage ?? [];
  return Object.keys(profile.attributes ?? {})
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const claim = latestClaimFor(key, lineage);
      return {
        key,
        value: displayValue(profile.attributes[key]),
        source: claim?.source ?? null,
        sourceId: claim?.sourceId ?? null,
        recordedAt: claim?.timestamp ?? null,
      };
    });
}

/**
 * Share of attributes that can be traced to a named source, 0-100.
 *
 * This is the honest headline for a Customer 360: a profile assembled from
 * unattributed writes looks identical to a fully governed one until you measure
 * how much of it has provenance.
 */
export function attributionCoveragePct(sources: AttributeSource[]): number {
  if (sources.length === 0) return 0;
  const attributed = sources.filter((s) => s.source !== null).length;
  return Math.round((attributed / sources.length) * 100);
}

/** Distinct contributing systems, most recent contribution first. */
export function contributingSources(lineage: CDPProfileLineageEntry[]): Array<{ source: string; lastSeen: string }> {
  const latest = new Map<string, string>();
  for (const entry of lineage) {
    const seen = latest.get(entry.source);
    if (seen === undefined || entry.timestamp > seen) latest.set(entry.source, entry.timestamp);
  }
  return [...latest.entries()]
    .map(([source, lastSeen]) => ({ source, lastSeen }))
    .sort((a, b) => (a.lastSeen === b.lastSeen ? a.source.localeCompare(b.source) : b.lastSeen.localeCompare(a.lastSeen)));
}

/** Lineage newest-first, which is the order a steward reads a provenance trail in. */
export function lineageNewestFirst(lineage: CDPProfileLineageEntry[]): CDPProfileLineageEntry[] {
  return [...lineage].reverse();
}
