/**
 * Candidate ↔ panel conflict-of-interest DETECTION (pure) — R-RA-0117.
 * Heuristic matching between a candidate and the interview/screening panel; the
 * output flags are advisory (for HR review + recusal), not an automatic decision.
 * Complements the panelist COI DECLARATION built in the interview-panel module.
 * No I/O.
 */

export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];
const SEV_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export interface CandidateProfile {
  name: string;
  email?: string | null;
  phone?: string | null;
  institutions?: string[] | null;
  address?: string | null;
}
export interface PanelMember {
  memberId: string;
  memberName: string;
  email?: string | null;
  phone?: string | null;
  institution?: string | null;
  declaredCoi?: boolean;       // panelist self-declared a conflict (from the panel module)
  coiNote?: string | null;
}

export interface ConflictFlag {
  memberId: string;
  memberName: string;
  type: "identical_name" | "shared_name_token" | "shared_email" | "shared_phone" | "shared_institution" | "declared_conflict";
  severity: Severity;
  detail: string;
}
export interface CoiScanResult {
  flags: ConflictFlag[];
  highestSeverity: Severity | null;
  hasConflict: boolean;        // true when any high/medium flag exists
}

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const digits = (s: string | null | undefined) => (s || "").replace(/\D/g, "");
/** Name tokens with punctuation stripped, dropping single-letter initials. */
function nameTokens(name: string): string[] {
  return (name || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
}
/** Order-independent full-name equality via sorted token sets ("A B" == "B A"). */
function sameNameTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const sb = new Set(b);
  return a.length === new Set(a).size && a.every((t) => sb.has(t)) && new Set(a).size === sb.size;
}
function phoneKey(s: string | null | undefined): string {
  const d = digits(s);
  return d.length >= 10 ? d.slice(-10) : ""; // last 10 digits, ignore country code; too-short = no match
}

/**
 * Detect potential conflicts of interest between a candidate and each panel member.
 * A panel member may raise multiple flags (e.g. shared surname AND shared phone).
 */
export function detectConflicts(candidate: CandidateProfile, panel: readonly PanelMember[]): CoiScanResult {
  const flags: ConflictFlag[] = [];
  const cTokens = nameTokens(candidate.name);
  const cEmail = norm(candidate.email);
  const cPhone = phoneKey(candidate.phone);
  const cInsts = new Set((candidate.institutions ?? []).map(norm).filter(Boolean));

  for (const m of panel) {
    const push = (type: ConflictFlag["type"], severity: Severity, detail: string) =>
      flags.push({ memberId: m.memberId, memberName: m.memberName, type, severity, detail });

    // Only the authoritative declaredCoi boolean triggers this flag; the note only
    // enriches the detail (a note alone would cause high-severity false positives).
    if (m.declaredCoi) push("declared_conflict", "high", `panelist declared a conflict${m.coiNote ? `: ${m.coiNote}` : ""}`);

    // Order-independent name matching (handles "Ravi Kumar" == "Kumar Ravi", commas).
    const mTokens = nameTokens(m.memberName);
    if (sameNameTokens(cTokens, mTokens)) {
      push("identical_name", "high", "candidate and panelist have the same name (any order)");
    } else {
      const shared = [...new Set(cTokens)].filter((t) => new Set(mTokens).has(t));
      if (shared.length > 0) push("shared_name_token", "medium", `shared name token(s) "${shared.join(", ")}" (possible relative or name-order variant)`);
    }

    if (cEmail && norm(m.email) === cEmail && cEmail !== "") push("shared_email", "high", "candidate and panelist share an email address");
    if (cPhone && phoneKey(m.phone) === cPhone && cPhone !== "") push("shared_phone", "high", "candidate and panelist share a phone number");

    const mInst = norm(m.institution);
    if (mInst && cInsts.has(mInst)) push("shared_institution", "low", `shared institution "${m.institution}"`);
  }

  const highestSeverity = flags.reduce<Severity | null>((best, f) => (!best || SEV_RANK[f.severity] > SEV_RANK[best] ? f.severity : best), null);
  return {
    flags,
    highestSeverity,
    hasConflict: flags.some((f) => f.severity === "high" || f.severity === "medium"),
  };
}
