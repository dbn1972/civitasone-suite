import type { LookupCandidate } from "@civitasone/scan-link";

/** File states (files.estab_files.status) that accept newly linked scanned documents. */
export const ACCEPTING_STATUSES = ["draft", "active"] as const;
/** States that reject new links with reason FILE_CLOSED. */
export const CLOSED_STATUSES = ["closed", "archived"] as const;

export function fileAcceptsDocuments(status: string): boolean {
  return (ACCEPTING_STATUSES as readonly string[]).includes(status);
}

/** Classifications never offered through the lookup (subject/file-no would leak to document-service callers). */
export const LOOKUP_EXCLUDED_CLASSIFICATIONS = ["top_secret", "secret"] as const;

/** Linking to these classifications is refused (TARGET_CLASSIFIED) until a clearance-based path is a product decision. */
export function linkRefusedForClassification(c: string): boolean {
  return (LOOKUP_EXCLUDED_CLASSIFICATIONS as readonly string[]).includes(c);
}

export const LOOKUP_MAX = 10;
export const FUZZY_MIN_SCORE = 0.2;
/** Fuzzy (subject / partial file-no) matches never reach exact-match confidence. */
export const FUZZY_CEILING = 0.85;

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+/gu;

export function normaliseFileNo(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, "");
}

export function tokenise(v: string): string[] {
  const out = new Set<string>();
  for (const m of v.toLowerCase().match(TOKEN_RE) ?? []) if (m.length >= 3) out.add(m);
  return [...out];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Escape LIKE wildcards so user text is matched literally. */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Confidence of a candidate file for a (fileNo, subject) query.
 *  - exact file number (case/space-insensitive) = 1.0
 *  - partial file number (substring, >= 4 chars) = 0.7
 *  - subject token overlap = up to FUZZY_CEILING (0.85)
 * Returns 0 when nothing matches well enough.
 */
export function scoreLookup(
  file: { fileNo: string; subject: string },
  q: { fileNo?: string | undefined; subject?: string | undefined },
): number {
  let best = 0;
  if (q.fileNo && q.fileNo.trim()) {
    const want = normaliseFileNo(q.fileNo);
    const have = normaliseFileNo(file.fileNo);
    if (want === have) return 1;
    if (want.length >= 4 && have.includes(want)) best = Math.max(best, 0.7);
  }
  if (q.subject && q.subject.trim()) {
    const qt = tokenise(q.subject);
    const st = new Set(tokenise(file.subject));
    if (qt.length > 0 && st.size > 0) {
      const inter = qt.filter((t) => st.has(t)).length;
      const union = new Set([...qt, ...st]).size;
      const coverage = inter / qt.length;
      const jaccard = inter / union;
      const s = round2(FUZZY_CEILING * (0.6 * coverage + 0.4 * jaccard));
      if (s >= FUZZY_MIN_SCORE) best = Math.max(best, s);
    }
  }
  return best;
}

export type LookupFileRow = { id: string; fileNo: string; subject: string; status: string };

/** Rank + cap candidates (pure; the SQL layer only pre-filters). */
export function rankCandidates(
  rows: LookupFileRow[],
  q: { fileNo?: string | undefined; subject?: string | undefined },
): LookupCandidate[] {
  return rows
    .map((r) => ({ r, confidence: scoreLookup(r, q) }))
    .filter((x) => x.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || a.r.fileNo.localeCompare(b.r.fileNo))
    .slice(0, LOOKUP_MAX)
    .map(({ r, confidence }) => ({
      target: "eoffice_file" as const,
      targetId: r.id,
      label: `${r.fileNo} - ${r.subject}`.slice(0, 280) + (fileAcceptsDocuments(r.status) ? "" : ` [${r.status}]`),
      amountMinor: null,
      reference: r.fileNo,
      confidence,
    }));
}
