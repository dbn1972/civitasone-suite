/** works feature — small shared display helpers. */
import type { BillStatus } from "./types";
import { formatIndianDate } from "@/lib/formatters";

/**
 * Calendar date for the works registers. Delegates to the shared
 * formatIndianDate ("dd Mon yyyy", IST-pinned) so the register and the AA/TS
 * detail pages render identical date strings (GAP-WORKS-APPROVALS-AA/TS-DETAIL-05);
 * the works-local implementation used en-IN toLocaleDateString with no fixed
 * timezone, which could disagree by a day near midnight. Falls back to "—".
 */
export function fmtDate(iso: string | null | undefined): string {
  return formatIndianDate(iso);
}

/** Title-case a snake/kebab enum token, e.g. "so_finalized" → "So finalized". */
export function humanize(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/[_-]+/g, " ").trim();
  return s.length === 0 ? "—" : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Shorten a UUID for compact display, e.g. "3f9a1c20…". Falls back to "—". */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * GAP-WORKS-TENDERS-01 / DETAIL-05: a single honest tender-status derivation
 * shared by the list (TendersTable) and the detail page.
 *
 * The works-service tenders list endpoint returns NO status column (see
 * listTenders() in services/works-service/src/modules/tender/repo.ts — only
 * pre_tenders.status exists, and that table is not joined), so a real
 * lifecycle status ("open"/"closed"/"awarded") cannot be sourced from the
 * list. The previous code invented one from the opening date and labelled it
 * "Open"/"Closed", which misleads procurement staff (an awarded tender reads
 * "Open" until its opening date; a past-dated pre-tender reads "Closed" before
 * any bid is invited).
 *
 * This helper instead reports ONLY what the data actually says:
 *  - an explicit `awarded` flag (derived on the detail page from a quotation
 *    carrying an awardId, or a backend status when one is ever supplied) wins
 *    and shows "Awarded";
 *  - otherwise the opening date is reported as a neutral schedule fact —
 *    "Upcoming" (opening date in the future), "Opening date passed" (in the
 *    past), or "—" (no opening date / unknown) — never a pipeline Open/Closed
 *    claim the backend does not own.
 *
 * `tone` maps each to a StatusPill variant so the UI can render it consistently.
 */
export type TenderStatusKey = "awarded" | "upcoming" | "opening_passed" | "unknown";

export interface TenderStatusView {
  key: TenderStatusKey;
  label: string;
  tone: "good" | "info" | "warn" | "muted";
}

export function deriveTenderStatus(args: {
  openingDate?: string | null;
  awarded?: boolean;
  /** An explicit backend status, used verbatim (humanised) if ever present. */
  backendStatus?: string | null;
  now?: number;
}): TenderStatusView {
  const { openingDate, awarded, backendStatus, now = Date.now() } = args;
  if (awarded) return { key: "awarded", label: "Awarded", tone: "good" };
  if (backendStatus && backendStatus.trim().length > 0) {
    const label = humanize(backendStatus);
    return { key: "unknown", label, tone: "info" };
  }
  if (!openingDate) return { key: "unknown", label: "—", tone: "muted" };
  const t = new Date(openingDate).getTime();
  if (!Number.isFinite(t)) return { key: "unknown", label: "—", tone: "muted" };
  if (t >= now) return { key: "upcoming", label: "Upcoming", tone: "info" };
  return { key: "opening_passed", label: "Opening date passed", tone: "warn" };
}

/**
 * Buckets the granular bill workflow status (draft → so/sdo/auditor/dao/do
 * finalized → submitted) into the coarse status the billing list's stat
 * cards expect: draft | pending | finalized | submitted_ifms.
 */
export function billBucket(status: BillStatus | string): "draft" | "pending" | "finalized" | "submitted_ifms" {
  if (status === "draft") return "draft";
  if (status === "submitted") return "submitted_ifms";
  if (status === "do_finalized") return "finalized";
  return "pending"; // so/sdo/auditor/dao_finalized — mid-workflow
}

/**
 * The five mutually-exclusive progress buckets used by the execution stat
 * cards (GAP-WORKS-EXECUTION-03). The previous inline logic on
 * execution/page.tsx left two gaps — rows at 50–79% and rows at exactly 0%
 * fell in NO bucket, and 100% rows were double-counted in both "On Track"
 * and "Completed" — so the cards never summed to the Progress-Entries total.
 *
 * DECISION (conservative, recorded for human review): buckets are defined by
 * cumulative percentage only (schedule-based "delay" needs plannedEnd, which
 * the progress row does not carry — see the gap's step 3). The boundaries are:
 *   completed   = pct >= 100
 *   onTrack     = 80 <= pct < 100
 *   inProgress  = 50 <= pct < 80
 *   atRisk      = 0  <  pct < 50
 *   notStarted  = pct <= 0
 * Every row lands in exactly one bucket, so the five counts always sum to the
 * total. "atRisk" replaces the old "Delayed" label because the figure is a
 * low-percentage signal, not a schedule-miss; the card copy was updated to
 * match so management does not read it as a dates-based delay indicator.
 */
export type ProgressBucket = "completed" | "onTrack" | "inProgress" | "atRisk" | "notStarted";

export function progressBucket(pct: number): ProgressBucket {
  const p = Number.isFinite(pct) ? pct : 0;
  if (p >= 100) return "completed";
  if (p >= 80) return "onTrack";
  if (p >= 50) return "inProgress";
  if (p > 0) return "atRisk";
  return "notStarted";
}

/**
 * GAP-WORKS-BILLING-01: present the bills.bill_mode enum
 * (services/works-service/src/modules/billing/schema.ts — "abstract" | "e_mb")
 * as a human label. humanize() alone renders "e_mb" as "E mb"; this keeps the
 * canonical "e-MB" / "Abstract" spelling. Unknown modes fall back to
 * humanize() so a newly-added backend enum value still reads sensibly.
 */
export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return "—";
  switch (mode) {
    case "e_mb":
      return "e-MB";
    case "abstract":
      return "Abstract";
    default:
      return humanize(mode);
  }
}

/**
 * GAP-WORKS-BILLING-WORKID-06: a single shared label for the granular bill
 * workflow status (bills.status). The register shows the coarse billBucket()
 * pill; the per-work detail page and BillingActions show this granular label
 * so "So finalized" in the table matches "Current: So finalized" in the
 * finalize stepper. Thin wrapper over humanize() so both call sites agree.
 */
export function billStatusLabel(status: BillStatus | string | null | undefined): string {
  return humanize(status);
}

/**
 * GAP-WORKS-BILLING-WORKID-02: the bill finalization workflow order, mirroring
 * works-service billing/domain.ts billFinalizationSequence(). Exported, typed
 * to the real BillStatus union, and reused by BillingActions instead of a
 * local string[] so FE and BE can't drift. "draft" is the implicit start
 * state (not in the sequence); "submitted" is terminal (IFMS hand-off).
 */
export const BILL_FINALIZE_SEQUENCE: readonly BillStatus[] = [
  "so_finalized",
  "sdo_finalized",
  "auditor_finalized",
  "dao_finalized",
  "do_finalized",
] as const;

/** MB finalization order, mirroring works-service eMbFinalizationSequence(). */
export const MB_FINALIZE_SEQUENCE = [
  "so_finalized",
  "sdo_finalized",
  "estimator_finalized",
  "do_finalized",
] as const;

/**
 * GAP-WORKS-BILLING-WORKID-02: the next finalize step for `current`, or null
 * when there is no legitimate next step. Unlike the old BillingActions-local
 * helper, an UNKNOWN status (e.g. "submitted", already sent to IFMS) returns
 * null instead of silently falling back to seq[0] — so an already-submitted
 * bill is never offered a spurious "→ So finalized" advance. Mirrors the
 * server's isValidNextStep() (billing/domain.ts): only "draft" starts the
 * sequence.
 */
export function nextFinalizeStep(
  seq: readonly string[],
  current: string,
): string | null {
  if (current === "draft") return seq[0] ?? null;
  const idx = seq.indexOf(current);
  if (idx === -1) return null; // unknown / terminal (e.g. "submitted")
  if (idx >= seq.length - 1) return null; // last step reached
  return seq[idx + 1];
}
