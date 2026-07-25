/**
 * SVC-043 Tender document management — pure domain logic:
 * document supersede-versioning, corrigendum numbering/republish, and the
 * pre-bid query status machine.
 */

export class TenderDocsDomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "TenderDocsDomainError";
  }
}

export const DOC_TYPES = ["nit", "rfp", "boq", "corrigendum", "addendum", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Next monotonic sequence number from the current max (0 → 1). */
export function nextSeq(currentMax: number | null | undefined): number {
  return (currentMax ?? 0) + 1;
}

/**
 * Compute the versioning effect of uploading a new revision of a document.
 * If a current document of the same type exists it is superseded; the new
 * document's version is prior + 1 and it becomes current.
 */
export function nextDocVersion(currentVersion: number | null | undefined): number {
  return (currentVersion ?? 0) + 1;
}

// ── Pre-bid query status machine ─────────────────────────────────
export type PrebidStatus = "open" | "answered" | "published";

const PREBID_TRANSITIONS: Record<PrebidStatus, PrebidStatus[]> = {
  open:      ["answered"],
  answered:  ["published"],
  published: [],
};

export function assertPrebidTransition(from: string, to: PrebidStatus): void {
  const allowed = PREBID_TRANSITIONS[from as PrebidStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new TenderDocsDomainError("INVALID_TRANSITION", `pre-bid query cannot transition from '${from}' to '${to}'`);
  }
}

/** A corrigendum can only be republished once. */
export function assertRepublishable(alreadyRepublished: boolean): void {
  if (alreadyRepublished) {
    throw new TenderDocsDomainError("ALREADY_REPUBLISHED", "corrigendum has already been republished");
  }
}

/**
 * A tender must be in a state where documents/corrigenda can be issued.
 * Corrigenda amend a live procurement, so the tender must be published (or
 * still in draft while assembling the bid pack), not awarded/closed.
 */
export function assertTenderAmendable(status: string): void {
  const blocked = ["awarded", "cancelled", "closed"];
  if (blocked.includes(status)) {
    throw new TenderDocsDomainError("TENDER_NOT_AMENDABLE", `tender in status '${status}' cannot be amended`);
  }
}
