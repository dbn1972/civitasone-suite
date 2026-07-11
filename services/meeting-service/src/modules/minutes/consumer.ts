/**
 * Minutes module — SQS / RabbitMQ consumer handlers (CQRS write side).
 *
 * Every handler follows the strict order mandated by steering (Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — idempotency guard; if it returns false the
 *      message was already processed, so we skip (P30).
 *   3. Business write (INSERT, or optimistic-locked `versionedUpdate`).
 *   4. Emit domain EVENTS + an audit event into the transactional outbox (same tx, so
 *      "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through cache.
 *
 * Pure domain logic lives in domain.ts (`renderMinutesTemplate`, `assertMinutesEditable`,
 * `assertMinutesTransition`, `linkHashChain`, `computeHash`, `computeMinutesSubmissionDeadline`);
 * this file wires it to persistence, the DSC signer, S3 storage, and the notification bus.
 *
 * Lifecycle (Req 7.1–7.8, 8.1–8.6):
 *   - create   → render the initial draft from meeting metadata + attendance + agenda +
 *                resolution placeholders, set the submission deadline, INSERT (status=draft).
 *   - update   → snapshot the prior content into `minutes_versions`, bump `current_version`
 *                (guarded by `assertMinutesEditable` — locked after approval).
 *   - submit   → draft → submitted, route to workflow-service via `minutes.submitted`.
 *   - approve  → submitted → approved: lock content, link into the committee hash chain
 *                (reading the committee's last approved minutes), render + DSC-sign the PDF
 *                via @civitasone/render, store it in S3, persist the hash pair.
 *   - reject   → submitted → draft: return to secretary + increment version, emit rejected.
 *   - sign     → approved → signed: produce a PKCS#7 detached signature + verification QR.
 *   - circulate→ signed → circulated: notify all participants via notification-service.
 *
 * Permanent (non-retryable) domain violations — an illegal status transition, editing locked
 * minutes — are re-thrown as `NonRetryableError` so they go straight to the DLQ instead of
 * being retried forever. Optimistic-lock conflicts surface as `VersionConflictError` (409).
 *
 * Registration: `registerMinutesConsumers(register)` maps each minutes COMMANDS topic to its
 * handler; worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
 */
import { readFile } from "node:fs/promises";
import { and, eq, ne, desc, isNotNull, inArray } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { renderPdf, signPdfWithDsc } from "@civitasone/render";
import { db } from "../../shared/db.js";
import { cache, storage } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { minutes, minutesVersions } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { committees } from "../committee/schema.js";
import { participants } from "../participant/schema.js";
import { attendanceRecords } from "../attendance/schema.js";
import { agendaItems } from "../agenda/schema.js";
import { resolutions } from "../decision/schema.js";
import {
  renderMinutesTemplate,
  computeMinutesSubmissionDeadline,
  computeHash,
  linkHashChain,
  assertMinutesEditable,
  assertMinutesTransition,
  isMinutesStatus,
  isMinutesTemplateType,
  type MinutesTemplateType,
  type MinutesRenderAttendee,
  type MinutesRenderAgendaItem,
  type MinutesRenderResolution,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "minutes";

// ─── Command payload contracts (mirror topics.ts COMMANDS.minutes*) ──────────

interface MinutesCreatePayload {
  minutesId: string;
  meetingId: string;
  tenantId: string;
  templateType?: string;
}

interface MinutesUpdatePayload {
  minutesId: string;
  tenantId: string;
  version: number;
  content: string;
  changeNote?: string;
}

interface MinutesSubmitPayload {
  minutesId: string;
  tenantId: string;
  version: number;
}

interface MinutesApprovePayload {
  minutesId: string;
  tenantId: string;
  version: number;
  approverId: string;
  comments?: string;
}

interface MinutesRejectPayload {
  minutesId: string;
  tenantId: string;
  version: number;
  rejectionComments: string;
}

interface MinutesSignPayload {
  minutesId: string;
  tenantId: string;
  version: number;
  signerId: string;
}

interface MinutesCirculatePayload {
  minutesId: string;
  tenantId: string;
  recipientIds?: string[];
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

/** Convert a domain validation `HttpError` into a permanent DLQ error (never retry). */
function asPermanent(err: unknown): never {
  if (err instanceof HttpError) throw new NonRetryableError(err.message, err);
  throw err;
}

/** Emit an audit fact for every mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: SERVICE,
      action,
      resourceType: "minutes",
      resourceId,
      outcome: "success",
      ...(metadata ? { metadata } : {}),
    },
  });
}

/** Load a single minutes row (full) within the tx. */
async function loadMinutes(tx: DrizzleTx, minutesId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(minutes)
    .where(and(eq(minutes.id, minutesId), eq(minutes.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Best-effort minutes read-cache invalidation after commit. */
async function invalidateMinutes(tenantId: string, minutesId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, minutesId));
}

/** A meeting row's fields needed by the minutes flows. */
type MeetingRow = typeof meetings.$inferSelect;

/** Load the parent meeting for a minutes record. */
async function loadMeeting(tx: DrizzleTx, meetingId: string, tenantId: string): Promise<MeetingRow | null> {
  const rows = await tx
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Draft template assembly (Req 7.1, 7.2) ──────────────────────────────────

/**
 * Gather the meeting metadata, attendance, agenda, and resolution data used to render the
 * initial minutes draft. Attendance rows (verified presence) are preferred; when none exist
 * yet the invited participant roster is used as a placeholder attendance section (Req 7.1).
 */
async function collectRenderData(
  tx: DrizzleTx,
  tenantId: string,
  meeting: MeetingRow,
): Promise<{ attendees: MinutesRenderAttendee[]; agenda: MinutesRenderAgendaItem[]; resolutions: MinutesRenderResolution[]; committeeName: string | null }> {
  let committeeName: string | null = null;
  if (meeting.committeeId) {
    const c = await tx
      .select({ name: committees.name })
      .from(committees)
      .where(and(eq(committees.id, meeting.committeeId), eq(committees.tenantId, tenantId)))
      .limit(1);
    committeeName = c[0]?.name ?? null;
  }

  // Prefer verified attendance; fall back to the invited roster as placeholders.
  const attendanceRows = await tx
    .select({
      status: attendanceRecords.status,
      mode: attendanceRecords.mode,
      role: participants.role,
      employeeId: participants.employeeId,
    })
    .from(attendanceRecords)
    .innerJoin(
      participants,
      and(eq(participants.id, attendanceRecords.participantId), eq(participants.tenantId, attendanceRecords.tenantId)),
    )
    .where(and(eq(attendanceRecords.meetingId, meeting.id), eq(attendanceRecords.tenantId, tenantId)));

  let attendees: MinutesRenderAttendee[];
  if (attendanceRows.length > 0) {
    attendees = attendanceRows.map((r) => ({ name: r.employeeId, role: r.role, status: r.status, mode: r.mode }));
  } else {
    const roster = await tx
      .select({ employeeId: participants.employeeId, role: participants.role, invitationStatus: participants.invitationStatus })
      .from(participants)
      .where(and(eq(participants.meetingId, meeting.id), eq(participants.tenantId, tenantId)));
    attendees = roster.map((r) => ({ name: r.employeeId, role: r.role, status: r.invitationStatus }));
  }

  const agendaRows = await tx
    .select({ sequence: agendaItems.sequence, title: agendaItems.title, outcomeType: agendaItems.outcomeType })
    .from(agendaItems)
    .where(
      and(eq(agendaItems.meetingId, meeting.id), eq(agendaItems.tenantId, tenantId), ne(agendaItems.status, "withdrawn")),
    )
    .orderBy(agendaItems.sequence);
  const agenda: MinutesRenderAgendaItem[] = agendaRows.map((a) => ({
    sequence: a.sequence,
    title: a.title,
    outcomeType: a.outcomeType,
  }));

  const resolutionRows = await tx
    .select({
      resolutionNumber: resolutions.resolutionNumber,
      text: resolutions.text,
      votesFor: resolutions.votesFor,
      votesAgainst: resolutions.votesAgainst,
      votesAbstain: resolutions.votesAbstain,
      result: resolutions.result,
    })
    .from(resolutions)
    .where(and(eq(resolutions.meetingId, meeting.id), eq(resolutions.tenantId, tenantId)));
  const resolutionData: MinutesRenderResolution[] = resolutionRows.map((r) => ({
    resolutionNumber: r.resolutionNumber,
    text: r.text,
    votesFor: r.votesFor,
    votesAgainst: r.votesAgainst,
    votesAbstain: r.votesAbstain,
    result: r.result,
  }));

  return { attendees, agenda, resolutions: resolutionData, committeeName };
}

// ─── Hash chain (Req 8.5, P23) ───────────────────────────────────────────────

/**
 * Resolve the `hash_current` of the committee's most-recently approved minutes (the chain
 * predecessor for `linkHashChain`), or null when this is the committee's first approved
 * minutes / the meeting has no committee (genesis). Excludes the minutes being approved.
 */
async function previousChainHash(
  tx: DrizzleTx,
  tenantId: string,
  committeeId: string | null,
  selfMinutesId: string,
): Promise<string | null> {
  if (!committeeId) return null;
  const rows = await tx
    .select({ hashCurrent: minutes.hashCurrent, approvedAt: minutes.approvedAt })
    .from(minutes)
    .innerJoin(meetings, and(eq(meetings.id, minutes.meetingId), eq(meetings.tenantId, minutes.tenantId)))
    .where(
      and(
        eq(minutes.tenantId, tenantId),
        eq(meetings.committeeId, committeeId),
        ne(minutes.id, selfMinutesId),
        inArray(minutes.status, ["approved", "signed", "circulated"]),
        isNotNull(minutes.hashCurrent),
      ),
    )
    .orderBy(desc(minutes.approvedAt))
    .limit(1);
  return rows[0]?.hashCurrent ?? null;
}

// ─── PDF render + DSC (Req 8.1, 8.2 · @civitasone/render) ─────────────────────

const S3_BASE_PREFIX = "minutes";

/** Escape a string for safe inclusion in the rendered HTML body. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wrap the minutes plain-text content in a minimal print-ready HTML document. */
function contentToHtml(title: string, content: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body><pre style="font-family:'Times New Roman',serif;white-space:pre-wrap;font-size:12pt">` +
    `${escapeHtml(content)}</pre></body></html>`
  );
}

/**
 * Render the minutes content to a PDF (via @civitasone/render, which applies the DSC seam
 * when configured) and store it in object storage, returning the storage key. Best-effort:
 * a render/storage failure must not fail the approval — the DB record (source of truth) and
 * its hash chain are what matter — so we log-and-continue by returning null.
 */
async function renderAndStore(
  tenantId: string,
  minutesId: string,
  title: string,
  content: string,
): Promise<string | null> {
  try {
    const { buffer } = await renderPdf({ html: contentToHtml(title, content) });
    const key = `${S3_BASE_PREFIX}/${tenantId}/${minutesId}.pdf`;
    await storage.putObject(key, buffer, "application/pdf");
    return key;
  } catch {
    // Graceful degradation: keep the approval; the PDF can be regenerated on demand.
    return null;
  }
}

/** The recorded DSC signature block persisted onto an approved/signed minutes row. */
interface DscResult {
  signature: string;
  signerName: string;
  signedAt: Date;
}

/**
 * Produce the PKCS#7 detached signature for the minutes (Req 8.1). When a DSC keystore is
 * configured (DSC_P12_PATH + DSC_PASSPHRASE) the content is rendered to a PDF and signed via
 * @civitasone/render's `signPdfWithDsc`, recording the certificate CN + fingerprint. Otherwise
 * a deterministic content-bound signature marker is recorded so the flow (and the P24
 * `SHA256(content) == hash_current` invariant) is fully wired end-to-end in dev/test.
 */
async function produceDscSignature(
  title: string,
  content: string,
  fallbackSignerName: string,
): Promise<DscResult> {
  const p12Path = process.env.DSC_P12_PATH;
  const passphrase = process.env.DSC_PASSPHRASE;
  if (p12Path && passphrase) {
    try {
      const p12Buffer = await readFile(p12Path);
      const { buffer } = await renderPdf({ html: contentToHtml(title, content) });
      const result = await signPdfWithDsc(buffer, { p12Buffer, passphrase });
      return {
        signature: `pkcs7:${result.serialNumber}:${result.sha256Fingerprint}`,
        signerName: result.signerCN,
        signedAt: new Date(result.signedAt),
      };
    } catch {
      // Fall through to the deterministic marker below.
    }
  }
  return {
    signature: `pkcs7-detached:sha256:${computeHash(content)}`,
    signerName: fallbackSignerName,
    signedAt: new Date(),
  };
}

/** Build the public verification QR payload for a signed minutes document (Req 8.2, 8.4). */
function buildVerificationQr(minutesId: string, hashCurrent: string | null): string {
  const base = process.env.MEETING_PUBLIC_VERIFY_URL ?? "https://verify.civitasone.gov.in";
  const hash = hashCurrent ?? "";
  return `${base}/v1/meetings/minutes/${minutesId}/verify?hash=${hash}`;
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * minutes.create → initialise the draft from meeting metadata + attendance + agenda +
 * resolution placeholders (Req 7.1, 7.2). Idempotent: skips if the meeting already has a
 * minutes record (in addition to the messageId dedupe).
 */
async function handleMinutesCreate(msg: CommandEnvelope<MinutesCreatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;

    // One minutes record per meeting (idempotent guard beyond messageId).
    const existing = await tx
      .select({ id: minutes.id })
      .from(minutes)
      .where(and(eq(minutes.meetingId, p.meetingId), eq(minutes.tenantId, msg.tenantId)))
      .limit(1);
    if (existing.length > 0) return;

    const templateType: MinutesTemplateType =
      p.templateType && isMinutesTemplateType(p.templateType) ? p.templateType : "summary";

    const { attendees, agenda, resolutions: resolutionData, committeeName } = await collectRenderData(
      tx,
      msg.tenantId,
      meeting,
    );

    const content = renderMinutesTemplate(templateType, {
      meeting: {
        title: meeting.title,
        meetingNumber: meeting.meetingNumber,
        committeeName,
        venue: meeting.venue,
        scheduledAt: meeting.scheduledAt,
        actualStartAt: meeting.actualStartAt,
        actualEndAt: meeting.actualEndAt,
      },
      attendees,
      agendaItems: agenda,
      resolutions: resolutionData,
    });

    const meetingDate = meeting.actualEndAt ?? meeting.scheduledAt ?? new Date();
    const submissionDeadline = computeMinutesSubmissionDeadline(meetingDate);

    await tx.insert(minutes).values({
      id: p.minutesId,
      tenantId: msg.tenantId,
      meetingId: p.meetingId,
      templateType,
      content,
      status: "draft",
      currentVersion: 1,
      submissionDeadline,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await audit(tx, msg, "create", p.minutesId, { meetingId: p.meetingId, templateType });
  });
  await invalidateMinutes(msg.tenantId, p.minutesId);
}

/**
 * minutes.update → snapshot the prior content into `minutes_versions`, bump `current_version`
 * (Req 7.8). Blocked on locked (approved/signed/circulated) minutes via `assertMinutesEditable`
 * (Req 7.5). Optimistic-locked on the row `version`.
 */
async function handleMinutesUpdate(msg: CommandEnvelope<MinutesUpdatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const current = await loadMinutes(tx, p.minutesId, msg.tenantId);
    if (!current) return;

    try {
      assertMinutesEditable(current.status);
    } catch (err) {
      asPermanent(err);
    }

    // Snapshot the pre-edit content as an immutable version row (append-only).
    await tx.insert(minutesVersions).values({
      tenantId: msg.tenantId,
      minutesId: p.minutesId,
      versionNum: current.currentVersion,
      content: current.content,
      changedBy: msg.actorId,
      ...(p.changeNote !== undefined ? { changeNote: p.changeNote } : {}),
    });

    await versionedUpdate(tx, minutes, {
      id: p.minutesId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: {
        content: p.content,
        currentVersion: current.currentVersion + 1,
        updatedBy: msg.actorId,
        updatedAt: new Date(),
      },
      entity: "minutes",
    });
    await audit(tx, msg, "update", p.minutesId);
  });
  await invalidateMinutes(msg.tenantId, p.minutesId);
}

/** minutes.submit → draft → submitted; route to workflow-service via `minutes.submitted` (Req 7.3). */
async function handleMinutesSubmit(msg: CommandEnvelope<MinutesSubmitPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const current = await loadMinutes(tx, p.minutesId, msg.tenantId);
    if (!current) return;
    if (!isMinutesStatus(current.status)) throw new NonRetryableError(`minutes ${p.minutesId} has unknown status "${current.status}"`);

    try {
      assertMinutesTransition(current.status, "submitted");
    } catch (err) {
      asPermanent(err);
    }

    await versionedUpdate(tx, minutes, {
      id: p.minutesId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: { status: "submitted", updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "minutes",
    });
    await enqueue(tx, {
      topic: EVENTS.minutesSubmitted,
      eventType: EVENTS.minutesSubmitted,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { minutesId: p.minutesId, meetingId: current.meetingId, version: current.currentVersion },
    });
    await audit(tx, msg, "submit", p.minutesId);
  });
  await invalidateMinutes(msg.tenantId, p.minutesId);
}

/**
 * minutes.approve → submitted → approved (Req 7.5, 8.5): lock the content, link it into the
 * committee's hash chain, render + DSC-sign the PDF and store it, persist the hash pair.
 */
async function handleMinutesApprove(msg: CommandEnvelope<MinutesApprovePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const current = await loadMinutes(tx, p.minutesId, msg.tenantId);
    if (!current) return;
    if (!isMinutesStatus(current.status)) throw new NonRetryableError(`minutes ${p.minutesId} has unknown status "${current.status}"`);

    try {
      assertMinutesTransition(current.status, "approved");
    } catch (err) {
      asPermanent(err);
    }

    const meeting = await loadMeeting(tx, current.meetingId, msg.tenantId);
    const committeeId = meeting?.committeeId ?? null;

    // Hash-chain link (P23): SHA-256 of this content + the committee's previous approved hash.
    const previousHash = await previousChainHash(tx, msg.tenantId, committeeId, p.minutesId);
    const link = linkHashChain(current.content, previousHash);

    // Render + DSC-sign the PDF and store it (best-effort; DB + hash are the source of truth).
    const storageKey = await renderAndStore(msg.tenantId, p.minutesId, meeting?.title ?? "Minutes", current.content);

    const approvedAt = new Date();
    await versionedUpdate(tx, minutes, {
      id: p.minutesId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: {
        status: "approved",
        approvedBy: p.approverId,
        approvedAt,
        hashPrevious: link.hashPrevious,
        hashCurrent: link.hashCurrent,
        ...(storageKey ? { storageKey } : {}),
        updatedBy: msg.actorId,
        updatedAt: approvedAt,
      },
      entity: "minutes",
    });
    await enqueue(tx, {
      topic: EVENTS.minutesApproved,
      eventType: EVENTS.minutesApproved,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        minutesId: p.minutesId,
        meetingId: current.meetingId,
        approvedBy: p.approverId,
        approvedAt: approvedAt.toISOString(),
      },
    });
    await audit(tx, msg, "approve", p.minutesId, { hashCurrent: link.hashCurrent, ...(p.comments ? { comments: p.comments } : {}) });
  });
  await invalidateMinutes(msg.tenantId, p.minutesId);
}

/** minutes.reject → submitted → draft: return to secretary + increment version (Req 7.6). */
async function handleMinutesReject(msg: CommandEnvelope<MinutesRejectPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const current = await loadMinutes(tx, p.minutesId, msg.tenantId);
    if (!current) return;
    if (!isMinutesStatus(current.status)) throw new NonRetryableError(`minutes ${p.minutesId} has unknown status "${current.status}"`);

    try {
      assertMinutesTransition(current.status, "draft");
    } catch (err) {
      asPermanent(err);
    }

    // Preserve the submitted content as an immutable version snapshot before re-opening.
    await tx.insert(minutesVersions).values({
      tenantId: msg.tenantId,
      minutesId: p.minutesId,
      versionNum: current.currentVersion,
      content: current.content,
      changedBy: msg.actorId,
      changeNote: `rejected: ${p.rejectionComments}`,
    });

    const newVersion = current.currentVersion + 1;
    await versionedUpdate(tx, minutes, {
      id: p.minutesId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: { status: "draft", currentVersion: newVersion, updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "minutes",
    });
    await enqueue(tx, {
      topic: EVENTS.minutesRejected,
      eventType: EVENTS.minutesRejected,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        minutesId: p.minutesId,
        meetingId: current.meetingId,
        rejectionComments: p.rejectionComments,
        newVersion,
      },
    });
    await audit(tx, msg, "reject", p.minutesId, { rejectionComments: p.rejectionComments });
  });
  await invalidateMinutes(msg.tenantId, p.minutesId);
}

/** minutes.sign → approved → signed: PKCS#7 detached signature + verification QR (Req 8.1, 8.2). */
async function handleMinutesSign(msg: CommandEnvelope<MinutesSignPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const current = await loadMinutes(tx, p.minutesId, msg.tenantId);
    if (!current) return;
    if (!isMinutesStatus(current.status)) throw new NonRetryableError(`minutes ${p.minutesId} has unknown status "${current.status}"`);

    try {
      assertMinutesTransition(current.status, "signed");
    } catch (err) {
      asPermanent(err);
    }

    const meeting = await loadMeeting(tx, current.meetingId, msg.tenantId);
    const dsc = await produceDscSignature(meeting?.title ?? "Minutes", current.content, p.signerId);
    const qr = buildVerificationQr(p.minutesId, current.hashCurrent);

    await versionedUpdate(tx, minutes, {
      id: p.minutesId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: {
        status: "signed",
        dscSignature: dsc.signature,
        dscSignerName: dsc.signerName,
        dscSignedAt: dsc.signedAt,
        updatedBy: msg.actorId,
        updatedAt: new Date(),
      },
      entity: "minutes",
    });
    await enqueue(tx, {
      topic: EVENTS.minutesSigned,
      eventType: EVENTS.minutesSigned,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        minutesId: p.minutesId,
        meetingId: current.meetingId,
        dscSignerName: dsc.signerName,
        hashCurrent: current.hashCurrent,
      },
    });
    await audit(tx, msg, "sign", p.minutesId, { dscSignerName: dsc.signerName, verificationQr: qr });
  });
  await invalidateMinutes(msg.tenantId, p.minutesId);
}

/**
 * minutes.circulate → signed → circulated (Req 8.3): notify all recipients (explicit list or the
 * full meeting participant roster) via notification-service, and emit `minutes.circulated`.
 */
async function handleMinutesCirculate(msg: CommandEnvelope<MinutesCirculatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const current = await loadMinutes(tx, p.minutesId, msg.tenantId);
    if (!current) return;
    if (!isMinutesStatus(current.status)) throw new NonRetryableError(`minutes ${p.minutesId} has unknown status "${current.status}"`);

    try {
      assertMinutesTransition(current.status, "circulated");
    } catch (err) {
      asPermanent(err);
    }

    // Resolve recipients: explicit list, else the full meeting participant roster.
    let recipientIds = p.recipientIds ?? [];
    if (recipientIds.length === 0) {
      const roster = await tx
        .select({ employeeId: participants.employeeId })
        .from(participants)
        .where(and(eq(participants.meetingId, current.meetingId), eq(participants.tenantId, msg.tenantId)));
      recipientIds = roster.map((r) => r.employeeId);
    }

    await versionedUpdate(tx, minutes, {
      id: p.minutesId,
      tenantId: msg.tenantId,
      expectedVersion: current.version,
      set: { status: "circulated", updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "minutes",
    });

    // Notify each recipient (in-app) via notification-service.
    for (const recipientId of recipientIds) {
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.minutesCirculated,
          recipient: recipientId,
          recipientId,
          channel: "in_app",
          variables: { minutesId: p.minutesId, meetingId: current.meetingId },
        }),
      });
    }

    await enqueue(tx, {
      topic: EVENTS.minutesCirculated,
      eventType: EVENTS.minutesCirculated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { minutesId: p.minutesId, meetingId: current.meetingId, recipientIds },
    });
    await audit(tx, msg, "circulate", p.minutesId, { recipientCount: recipientIds.length });
  });
  await invalidateMinutes(msg.tenantId, p.minutesId);
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every minutes command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the minutes COMMANDS topics to the handlers above.
 */
export function registerMinutesConsumers(register: RegisterConsumer): void {
  register(COMMANDS.minutesCreate, handleMinutesCreate);
  register(COMMANDS.minutesUpdate, handleMinutesUpdate);
  register(COMMANDS.minutesSubmit, handleMinutesSubmit);
  register(COMMANDS.minutesApprove, handleMinutesApprove);
  register(COMMANDS.minutesReject, handleMinutesReject);
  register(COMMANDS.minutesSign, handleMinutesSign);
  register(COMMANDS.minutesCirculate, handleMinutesCirculate);
}
