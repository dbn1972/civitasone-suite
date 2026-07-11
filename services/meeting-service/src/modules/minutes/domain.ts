/**
 * Minutes module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * Responsibilities (Req 7.1–7.8, 8.1, 8.5):
 *   - Template rendering: build the initial minutes draft in one of three shapes —
 *     verbatim (full discussion), summary (key points + decisions), resolution_only
 *     (formal decisions with vote counts) — from meeting metadata, attendance, agenda,
 *     and resolutions (Req 7.1, 7.2).
 *   - Version tracking + diff: line-level LCS diff between two minutes contents for the
 *     version-history view (Req 7.8).
 *   - Hash-chain computation: SHA-256 of content (`computeHash`), linked to the previous
 *     approved minutes of the same committee (`linkHashChain`), and chain verification
 *     (`verifyChain`) — the tamper-evidence backbone for P23/P24 (Req 8.5).
 *   - Submission-deadline enforcement: configurable, default 7 days AFTER the meeting, with
 *     the two-days-before / on-deadline alert points (Req 7.7).
 *   - minutes_approved invariant: once approved the content is locked; a small status
 *     machine governs draft → submitted → approved → signed → circulated with a
 *     rejection edge back to draft (Req 7.5, 7.6).
 *
 * Domain-rule violations are raised as the service's typed `HttpError` (via `httpError`) so
 * the standard error envelope + HTTP status contract is preserved end-to-end. These functions
 * remain pure and deterministic given their inputs (callers inject `now` for time checks).
 *
 * The hash primitives (`computeHash`, `linkHashChain`, `verifyChain`) are the public surface
 * exercised by the P23/P24 property tests in task 9.4.
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.5_
 */
import { createHash } from "node:crypto";
import { httpError } from "../../shared/context.js";

// ─── Domain vocabularies (mirror the migration value sets) ───────────────────

/** Minutes templates (Req 7.2). `resolution_only` matches the COMMANDS.minutesCreate payload. */
export const MINUTES_TEMPLATE_TYPES = ["verbatim", "summary", "resolution_only"] as const;
export type MinutesTemplateType = (typeof MINUTES_TEMPLATE_TYPES)[number];

/** Minutes lifecycle states (Req 7.5, 7.6). */
export const MINUTES_STATUSES = ["draft", "submitted", "approved", "signed", "circulated"] as const;
export type MinutesStatus = (typeof MINUTES_STATUSES)[number];

/** True if `value` is a recognised template type. */
export function isMinutesTemplateType(value: string): value is MinutesTemplateType {
  return (MINUTES_TEMPLATE_TYPES as readonly string[]).includes(value);
}

/** True if `value` is a recognised minutes status. */
export function isMinutesStatus(value: string): value is MinutesStatus {
  return (MINUTES_STATUSES as readonly string[]).includes(value);
}

// ─── Configuration (Req 7.7) ─────────────────────────────────────────────────

/** Tenant/committee-configurable minutes knobs. All fields optional; per-field defaults applied. */
export interface MinutesConfig {
  /** Days after the meeting by which the draft minutes must be submitted (Req 7.7). */
  submissionDeadlineDays?: number;
}

/** Default: minutes are due 7 days after the meeting (Req 7.7). */
export const DEFAULT_MINUTES_SUBMISSION_DEADLINE_DAYS = 7;
/** Default lead time (days before the deadline) for the reminder alert (Req 7.7). */
export const MINUTES_DEADLINE_ALERT_LEAD_DAYS = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function resolveDeadlineDays(config?: MinutesConfig): number {
  const d = config?.submissionDeadlineDays;
  return typeof d === "number" && Number.isFinite(d) && d >= 0 ? d : DEFAULT_MINUTES_SUBMISSION_DEADLINE_DAYS;
}

// ─── Submission deadline (Req 7.7) ───────────────────────────────────────────

/**
 * Compute the minutes submission cut-off = meeting reference date + deadlineDays. The
 * reference is normally the meeting's `actual_end_at` (falling back to `scheduled_at`), chosen
 * by the caller; this function just adds the configured window (default 7 days, Req 7.7).
 */
export function computeMinutesSubmissionDeadline(meetingDate: Date, config?: MinutesConfig): Date {
  const days = resolveDeadlineDays(config);
  return new Date(meetingDate.getTime() + days * MS_PER_DAY);
}

/** True when `now` is strictly past the submission deadline (Req 7.7). */
export function isMinutesOverdue(deadline: Date, now: Date): boolean {
  return now.getTime() > deadline.getTime();
}

/** The two alert points for a submission deadline (Req 7.7): two days before, and on the day. */
export interface MinutesDeadlineAlerts {
  /** When to send the advance reminder (deadline − lead days). */
  twoDaysBefore: Date;
  /** The deadline itself (on-the-day alert). */
  onDeadline: Date;
}

/** Compute the reminder alert points for a submission deadline (Req 7.7). */
export function computeMinutesDeadlineAlerts(
  deadline: Date,
  leadDays: number = MINUTES_DEADLINE_ALERT_LEAD_DAYS,
): MinutesDeadlineAlerts {
  return {
    twoDaysBefore: new Date(deadline.getTime() - Math.max(0, leadDays) * MS_PER_DAY),
    onDeadline: deadline,
  };
}

// ─── Minutes status machine + approval invariant (Req 7.5, 7.6) ──────────────

/**
 * Allowed minutes status transitions. `submitted → draft` is the rejection edge (Req 7.6):
 * a reviewer returns the draft to the secretary, the caller increments the version. There is
 * no edge out of an approved/signed/circulated document that returns to an editable state —
 * that is the minutes_approved immutability invariant (Req 7.5).
 */
const MINUTES_TRANSITIONS: Record<MinutesStatus, readonly MinutesStatus[]> = {
  draft:      ["submitted"],
  submitted:  ["approved", "draft"],
  approved:   ["signed"],
  signed:     ["circulated"],
  circulated: [],
};

/**
 * Statuses in which the minutes content is LOCKED against edits (Req 7.5). Once the chairperson
 * approves, the record is immutable; only signing and circulation (which do not touch content)
 * may follow.
 */
export function isMinutesLocked(status: string): boolean {
  return status === "approved" || status === "signed" || status === "circulated";
}

/**
 * Guard a content mutation (update draft) against a locked minutes record (Req 7.5). Throws
 * `MEETING_INVALID_TRANSITION` (422) when the minutes are approved/signed/circulated.
 */
export function assertMinutesEditable(status: string): void {
  if (isMinutesLocked(status)) {
    throw httpError("MEETING_INVALID_TRANSITION", "minutes are locked after approval and cannot be edited", {
      status,
    });
  }
}

/**
 * Structural check for a minutes status transition (Req 7.5, 7.6): true IFF `to` is reachable
 * from `from` in the minutes status machine.
 */
export function canMinutesTransition(from: MinutesStatus, to: MinutesStatus): boolean {
  return MINUTES_TRANSITIONS[from].includes(to);
}

/**
 * Assert a minutes status transition is allowed (Req 7.5, 7.6). Throws
 * `MEETING_INVALID_TRANSITION` (422) with the list of allowed targets otherwise.
 */
export function assertMinutesTransition(from: MinutesStatus, to: MinutesStatus): void {
  if (!canMinutesTransition(from, to)) {
    throw httpError(
      "MEETING_INVALID_TRANSITION",
      `cannot transition minutes from "${from}" to "${to}"`,
      { from, to, allowed: [...MINUTES_TRANSITIONS[from]] },
    );
  }
}

// ─── Hash chain (Req 8.5 · P23 · P24) ────────────────────────────────────────

/**
 * SHA-256 of the minutes content, as a 64-char lowercase hex string (fits `varchar(64)`).
 *
 * This is the canonical content digest: `dsc_signature` present ⇒ `SHA256(content) == hash_current`
 * (P24), so any post-signing modification of `content` is detectable by recomputing this.
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** The pair of chain hashes stored on a minutes row. */
export interface HashLink {
  /** `hash_current` of the previous approved minutes of the same committee (null at genesis). */
  hashPrevious: string | null;
  /** SHA-256 of this document's content. */
  hashCurrent: string;
}

/**
 * Link a minutes document into the committee's hash chain (Req 8.5, P23): its `hashCurrent` is
 * the SHA-256 of its content, and its `hashPrevious` is the `hashCurrent` of the previous
 * approved minutes of the same committee (or null for the first ever, the genesis document).
 *
 * Pure: the consumer resolves `previousHashCurrent` by reading the committee's last approved
 * minutes, then persists the returned pair alongside the DSC signature.
 */
export function linkHashChain(content: string, previousHashCurrent: string | null | undefined): HashLink {
  return {
    hashPrevious: previousHashCurrent ?? null,
    hashCurrent: computeHash(content),
  };
}

/** A minutes record as seen by the chain verifier (ordered oldest → newest per committee). */
export interface ChainRecord {
  content: string;
  hashPrevious: string | null;
  hashCurrent: string | null;
}

/** Outcome of verifying a committee's minutes hash chain. */
export interface ChainVerification {
  /** True when every content digest matches (P24) and every link is intact (P23). */
  valid: boolean;
  /** Zero-based index of the first record that broke the chain (absent when valid). */
  brokenAt?: number;
  /** Machine-readable reason for the break (absent when valid). */
  reason?: "content_hash_mismatch" | "chain_link_broken";
}

/**
 * Verify a committee's minutes hash chain, given the records ordered oldest → newest (Req 8.5).
 *
 * Two invariants are checked for every record:
 *   - Content integrity (P24): `hashCurrent === SHA256(content)` — detects tampering with a
 *     signed/approved document's content.
 *   - Linkage (P23): each record's `hashPrevious` equals the previous record's `hashCurrent`;
 *     the first (genesis) record's `hashPrevious` is unconstrained.
 *
 * Returns the first break found (with index + reason) or `{ valid: true }` for an intact chain.
 * An empty chain is vacuously valid.
 */
export function verifyChain(records: readonly ChainRecord[]): ChainVerification {
  let previous: ChainRecord | undefined;
  let index = 0;
  for (const rec of records) {
    if (rec.hashCurrent !== computeHash(rec.content)) {
      return { valid: false, brokenAt: index, reason: "content_hash_mismatch" };
    }
    if (previous && rec.hashPrevious !== previous.hashCurrent) {
      return { valid: false, brokenAt: index, reason: "chain_link_broken" };
    }
    previous = rec;
    index += 1;
  }
  return { valid: true };
}

// ─── Version diff (Req 7.8) ──────────────────────────────────────────────────

/** A single line in a computed diff. */
export type DiffOp = "added" | "removed" | "unchanged";
export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Line-level diff between two minutes contents (Req 7.8), computed via a longest-common-
 * subsequence walk so the result is a minimal, stable sequence of unchanged/removed/added
 * lines. Deterministic and pure — used to render the version-history comparison view.
 */
export function diffMinutes(oldContent: string, newContent: string): DiffLine[] {
  const a = oldContent.split("\n");
  const b = newContent.split("\n");
  const m = a.length;
  const n = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..]. (m+1) x (n+1), zero-initialised.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    const dpi = dp[i]!;
    const dpi1 = dp[i + 1]!;
    for (let j = n - 1; j >= 0; j--) {
      dpi[j] = a[i] === b[j] ? dpi1[j + 1]! + 1 : Math.max(dpi1[j]!, dpi[j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ op: "unchanged", text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ op: "removed", text: a[i]! });
      i += 1;
    } else {
      out.push({ op: "added", text: b[j]! });
      j += 1;
    }
  }
  while (i < m) {
    out.push({ op: "removed", text: a[i]! });
    i += 1;
  }
  while (j < n) {
    out.push({ op: "added", text: b[j]! });
    j += 1;
  }
  return out;
}

/** Summary counts for a diff (Req 7.8). */
export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
}

/** Aggregate a diff into added/removed/unchanged line counts (Req 7.8). */
export function summarizeDiff(diff: readonly DiffLine[]): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, unchanged: 0 };
  for (const line of diff) summary[line.op] += 1;
  return summary;
}

// ─── Template rendering (Req 7.1, 7.2) ───────────────────────────────────────

/** Meeting header fields used to render the minutes preamble. */
export interface MinutesRenderMeeting {
  title: string;
  meetingNumber?: string | null;
  committeeName?: string | null;
  venue?: string | null;
  scheduledAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
}

/** An attendee line for the attendance section (Req 7.1). */
export interface MinutesRenderAttendee {
  name: string;
  role?: string | null;
  /** present | absent | joined_late | left_early | attending_via_vc … */
  status?: string | null;
  /** in_person | vc … */
  mode?: string | null;
}

/** An agenda item with its (optional) discussion + decision, used per-template (Req 7.1, 7.2). */
export interface MinutesRenderAgendaItem {
  sequence: number;
  title: string;
  outcomeType?: string | null;
  /** Full discussion text — rendered only by the verbatim template. */
  discussion?: string | null;
  /** Key decision / conclusion — rendered by verbatim and summary templates. */
  decision?: string | null;
}

/** A formal resolution with its vote counts, rendered by all templates (Req 7.2). */
export interface MinutesRenderResolution {
  resolutionNumber?: string | null;
  text: string;
  votesFor?: number;
  votesAgainst?: number;
  votesAbstain?: number;
  result?: string | null;
}

/** The full data set the renderer draws from to initialise a draft (Req 7.1). */
export interface MinutesRenderData {
  meeting: MinutesRenderMeeting;
  attendees?: readonly MinutesRenderAttendee[];
  agendaItems?: readonly MinutesRenderAgendaItem[];
  resolutions?: readonly MinutesRenderResolution[];
}

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString() : "—";
}

function renderHeader(meeting: MinutesRenderMeeting): string[] {
  const lines: string[] = [];
  lines.push(`# Minutes: ${meeting.title}`);
  if (meeting.meetingNumber) lines.push(`Meeting No.: ${meeting.meetingNumber}`);
  if (meeting.committeeName) lines.push(`Committee: ${meeting.committeeName}`);
  lines.push(`Venue: ${meeting.venue ?? "—"}`);
  lines.push(`Scheduled: ${fmtDate(meeting.scheduledAt)}`);
  lines.push(`Started: ${fmtDate(meeting.actualStartAt)}`);
  lines.push(`Ended: ${fmtDate(meeting.actualEndAt)}`);
  return lines;
}

function renderAttendance(attendees: readonly MinutesRenderAttendee[]): string[] {
  const lines: string[] = ["", "## Attendance"];
  if (attendees.length === 0) {
    lines.push("_No attendance recorded._");
    return lines;
  }
  for (const a of attendees) {
    const role = a.role ? ` (${a.role})` : "";
    const mode = a.mode ? ` [${a.mode}]` : "";
    lines.push(`- ${a.name}${role} — ${a.status ?? "present"}${mode}`);
  }
  return lines;
}

function renderResolutionLine(r: MinutesRenderResolution): string {
  const num = r.resolutionNumber ? `${r.resolutionNumber}: ` : "";
  const forV = r.votesFor ?? 0;
  const againstV = r.votesAgainst ?? 0;
  const abstainV = r.votesAbstain ?? 0;
  const result = r.result ? ` — ${r.result}` : "";
  return `- ${num}${r.text} (For: ${forV}, Against: ${againstV}, Abstain: ${abstainV})${result}`;
}

function renderResolutions(resolutions: readonly MinutesRenderResolution[]): string[] {
  const lines: string[] = ["", "## Resolutions"];
  if (resolutions.length === 0) {
    lines.push("_No resolutions recorded._");
    return lines;
  }
  for (const r of resolutions) lines.push(renderResolutionLine(r));
  return lines;
}

/**
 * Render the initial minutes draft content for a meeting in the chosen template shape
 * (Req 7.1, 7.2). Pure and deterministic — the consumer persists the returned string as the
 * draft's `content`. Ordering of agenda items follows their `sequence`.
 *
 *   - verbatim        — header, attendance, and every agenda item with full discussion text
 *                       plus decision, then the resolutions section.
 *   - summary         — header, attendance, and every agenda item with its decision / key
 *                       point only (discussion omitted), then the resolutions section.
 *   - resolution_only — header and the resolutions section only (formal decisions + vote
 *                       counts), no per-item discussion.
 */
export function renderMinutesTemplate(templateType: MinutesTemplateType, data: MinutesRenderData): string {
  const attendees = data.attendees ?? [];
  const resolutions = data.resolutions ?? [];
  const agendaItems = [...(data.agendaItems ?? [])].sort((x, y) => x.sequence - y.sequence);

  const lines: string[] = [...renderHeader(data.meeting)];

  if (templateType === "resolution_only") {
    lines.push(...renderResolutions(resolutions));
    return lines.join("\n");
  }

  lines.push(...renderAttendance(attendees));
  lines.push("", "## Agenda Items");
  if (agendaItems.length === 0) {
    lines.push("_No agenda items._");
  } else {
    for (const item of agendaItems) {
      const outcome = item.outcomeType ? ` [${item.outcomeType}]` : "";
      lines.push("", `### ${item.sequence}. ${item.title}${outcome}`);
      if (templateType === "verbatim") {
        lines.push("**Discussion:**", item.discussion?.trim() ? item.discussion : "_To be recorded._");
      }
      lines.push("**Decision:**", item.decision?.trim() ? item.decision : "_To be recorded._");
    }
  }

  lines.push(...renderResolutions(resolutions));
  return lines.join("\n");
}
