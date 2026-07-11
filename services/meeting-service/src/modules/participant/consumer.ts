/**
 * Participant module — SQS / RabbitMQ consumer handlers (CQRS write side, Req 5.1–5.7).
 *
 * Every handler follows the strict order mandated by steering (Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — if it returns false the message was already
 *      processed, so we skip (idempotency; P30).
 *   3. Business write (INSERT, or optimistic-locked `versionedUpdate`).
 *   4. Emit domain EVENTS + `notification.send` fan-out + an audit event via the transactional
 *      outbox (same tx, so "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through participant cache.
 *
 * Pure domain rules live in domain.ts (`assertValidRoleAssignment`, `resolveRsvp`,
 * `assertNomineeAllowed`, `computeQuorumConfirmation`) and committee/domain.ts
 * (`requiredQuorumCount`); this file wires them to persistence and messaging.
 *
 * Quorum alert (Req 5.3, 5.4): after an RSVP is recorded we recompute the confirmed-vs-threshold
 * tally over the meeting's quorum-bearing participants. When the meeting is within 48 hours and
 * the confirmed count is below the committee's quorum threshold, we alert the secretary and
 * chairperson (via `notification.send`) and emit a `meeting.compliance.alert` fact, naming the
 * members who have not confirmed.
 *
 * PII (DPDP Act, Req 15.3): personal contact overrides are encrypted at rest by the
 * `encryptedText()` column and are NEVER placed in an event/notification payload or logged —
 * every notification addresses its recipient by `employeeId` (`recipientId`), and notification
 * variables carry only non-PII meeting metadata.
 *
 * Registration: `registerParticipantConsumers(register)` maps each participant COMMANDS topic to
 * its handler. worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
 */
import { and, eq } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { participants } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import {
  assertValidRoleAssignment,
  resolveRsvp,
  assertNomineeAllowed,
  computeQuorumConfirmation,
  isQuorumCountingRole,
  type RsvpResponse,
} from "./domain.js";
import { requiredQuorumCount, type QuorumRule } from "../committee/domain.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "participants";

/** Milliseconds in the 48-hour under-quorum alert window (Req 5.4). */
const QUORUM_ALERT_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Default invitation channels when the command does not restrict them (Req 5.2). */
const DEFAULT_INVITE_CHANNELS = ["email", "sms", "push"] as const;
type InvitationChannel = (typeof DEFAULT_INVITE_CHANNELS)[number];

// ─── Command payload contracts (mirror topics.ts COMMANDS.participant*) ────────

interface ParticipantAddEntry {
  id: string;
  employeeId: string;
  role: string;
  isMandatory?: boolean;
  attendanceMode?: string;
  agendaItemIds?: string[];
  personalEmail?: string;
  personalPhone?: string;
}

interface ParticipantAddPayload {
  meetingId: string;
  tenantId: string;
  participants: ParticipantAddEntry[];
}

interface ParticipantPatchPayload {
  role?: string;
  isMandatory?: boolean;
  attendanceMode?: string | null;
  agendaItemIds?: string[] | null;
  personalEmail?: string | null;
  personalPhone?: string | null;
}

interface ParticipantUpdatePayload {
  meetingId: string;
  participantId: string;
  version: number;
  patch: ParticipantPatchPayload;
}

interface ParticipantRemovePayload {
  meetingId: string;
  participantId: string;
  version: number;
  reason?: string;
}

interface ParticipantRespondPayload {
  meetingId: string;
  participantId: string;
  response: RsvpResponse;
  declineReason?: string;
  attendanceMode?: string;
}

interface ParticipantNominatePayload {
  meetingId: string;
  participantId: string;
  nomineeId: string;
  nomineeEmail?: string;
  nomineePhone?: string;
  reason?: string;
}

interface InvitationsSendPayload {
  meetingId: string;
  participantIds?: string[];
  channels?: InvitationChannel[];
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

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
      resourceType: "participant",
      resourceId,
      outcome: "success",
      ...(metadata ? { metadata } : {}),
    },
  });
}

/**
 * Enqueue a `notification.send` addressed to `employeeId` (Req 15.3 — recipients are always
 * referenced by id, never by raw PII). `variables` must contain only non-PII metadata.
 */
async function notify(
  tx: DrizzleTx,
  msg: MsgMeta,
  opts: { eventType: string; recipientId: string; channel?: InvitationChannel; variables: Record<string, string> },
): Promise<void> {
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: buildNotificationPayload({
      eventType: opts.eventType,
      recipient: opts.recipientId,
      recipientId: opts.recipientId,
      ...(opts.channel ? { channel: opts.channel } : {}),
      variables: opts.variables,
    }),
  });
}

/** Convert a NonRetryable domain violation: permanent errors go straight to the DLQ. */
function asNonRetryable(err: unknown): never {
  throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
}

/** Load a meeting's scheduling + role columns for quorum / invitation handling. */
async function getMeeting(tx: DrizzleTx, meetingId: string, tenantId: string) {
  const rows = await tx
    .select({
      id: meetings.id,
      status: meetings.status,
      title: meetings.title,
      scheduledAt: meetings.scheduledAt,
      durationMinutes: meetings.durationMinutes,
      venue: meetings.venue,
      committeeId: meetings.committeeId,
      chairpersonId: meetings.chairpersonId,
      secretaryId: meetings.secretaryId,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load a single participant row within the tx. */
async function getParticipant(tx: DrizzleTx, participantId: string, tenantId: string, meetingId: string) {
  const rows = await tx
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.id, participantId),
        eq(participants.tenantId, tenantId),
        eq(participants.meetingId, meetingId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Resolve the quorum threshold for a meeting's committee (Req 5.3): the required minimum
 * quorum-bearing members, derived from the committee's quorum rule against its active roster
 * size. Returns null when the meeting has no committee (no threshold to check against).
 */
async function resolveQuorumThreshold(
  tx: DrizzleTx,
  tenantId: string,
  committeeId: string | null,
): Promise<number | null> {
  if (!committeeId) return null;
  const rows = await tx
    .select({ quorumRule: committees.quorumRule })
    .from(committees)
    .where(and(eq(committees.id, committeeId), eq(committees.tenantId, tenantId)))
    .limit(1);
  const committee = rows[0];
  if (!committee) return null;

  const activeMembers = await tx
    .select({ memberId: committeeMembers.memberId })
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.tenantId, tenantId),
        eq(committeeMembers.committeeId, committeeId),
        eq(committeeMembers.status, "active"),
      ),
    );
  return requiredQuorumCount(committee.quorumRule as QuorumRule, activeMembers.length);
}

/**
 * After an RSVP, recompute the confirmed-vs-threshold quorum tally and, when the meeting is
 * within the 48-hour window and confirmations are below threshold, alert the secretary and
 * chairperson and emit a compliance fact naming the not-yet-confirmed members (Req 5.3, 5.4).
 * A no-op when the meeting has no committee (no threshold) or is outside the 48-hour window.
 */
async function checkQuorumAlert(
  tx: DrizzleTx,
  msg: MsgMeta,
  meeting: NonNullable<Awaited<ReturnType<typeof getMeeting>>>,
): Promise<void> {
  const scheduledAt = meeting.scheduledAt;
  if (!scheduledAt) return;
  const msUntil = scheduledAt.getTime() - Date.now();
  if (msUntil <= 0 || msUntil > QUORUM_ALERT_WINDOW_MS) return; // outside the 48h pre-meeting window

  const threshold = await resolveQuorumThreshold(tx, msg.tenantId, meeting.committeeId);
  if (threshold === null || threshold <= 0) return;

  const roster = await tx
    .select({
      employeeId: participants.employeeId,
      role: participants.role,
      invitationStatus: participants.invitationStatus,
    })
    .from(participants)
    .where(and(eq(participants.tenantId, msg.tenantId), eq(participants.meetingId, meeting.id)));

  const confirmation = computeQuorumConfirmation(roster, threshold);
  if (confirmation.met) return;

  // Members bearing on quorum who have NOT confirmed attendance (Req 5.4).
  const notConfirmedMemberIds = roster
    .filter((r) => isQuorumCountingRole(r.role) && r.invitationStatus !== "accepted")
    .map((r) => r.employeeId);

  await enqueue(tx, {
    topic: EVENTS.complianceAlert,
    eventType: EVENTS.complianceAlert,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      meetingId: meeting.id,
      ...(meeting.committeeId ? { committeeId: meeting.committeeId } : {}),
      alertType: "quorum_shortfall",
      detail: {
        threshold: confirmation.threshold,
        confirmedCount: confirmation.confirmedCount,
        shortfall: confirmation.shortfall,
        notConfirmedMemberIds,
      },
    },
  });

  const variables = {
    meetingId: meeting.id,
    threshold: String(confirmation.threshold),
    confirmedCount: String(confirmation.confirmedCount),
    shortfall: String(confirmation.shortfall),
  };
  const recipients = [meeting.secretaryId, meeting.chairpersonId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  for (const recipientId of recipients) {
    await notify(tx, msg, { eventType: EVENTS.complianceAlert, recipientId, channel: "email", variables });
  }
}

/** Best-effort participant read-cache invalidation after commit. */
async function invalidateParticipants(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, meetingId));
}

/** Minimal ICS (RFC 5545) calendar attachment for an invitation email (Req 5.2). */
function buildIcs(meeting: {
  id: string;
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  venue: string | null;
}): string {
  const fmt = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const end = new Date(meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000);
  const escapeText = (s: string): string => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//CivitasOne//${SERVICE}//EN`,
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@civitasone`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(meeting.scheduledAt)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${escapeText(meeting.title)}`,
    ...(meeting.venue ? [`LOCATION:${escapeText(meeting.venue)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * participant.add — validate each role assignment, reject duplicate active participants, then
 * INSERT the batch (Req 5.1, 5.7). A malformed role or a duplicate is a permanent error → DLQ.
 */
async function handleParticipantAdd(msg: CommandEnvelope<ParticipantAddPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    for (const entry of p.participants) {
      // Defence-in-depth: the route validator already checked this (Req 5.1, 5.7).
      try {
        assertValidRoleAssignment({ role: entry.role, agendaItemIds: entry.agendaItemIds ?? null });
      } catch (err) {
        asNonRetryable(err);
      }

      // Req 5.1: an employee may hold at most one participation on a meeting.
      const existing = await tx
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.tenantId, p.tenantId),
            eq(participants.meetingId, p.meetingId),
            eq(participants.employeeId, entry.employeeId),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        throw new NonRetryableError(
          `employee ${entry.employeeId} is already a participant of meeting ${p.meetingId}`,
        );
      }

      await tx.insert(participants).values({
        id: entry.id,
        tenantId: p.tenantId,
        meetingId: p.meetingId,
        employeeId: entry.employeeId,
        role: entry.role,
        isMandatory: entry.isMandatory ?? true,
        invitationStatus: "pending",
        attendanceMode: entry.attendanceMode ?? null,
        agendaItemIds: entry.agendaItemIds ?? null,
        personalEmail: entry.personalEmail ?? null,
        personalPhone: entry.personalPhone ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "participant_add", entry.id, { role: entry.role });
    }
  });
  await invalidateParticipants(msg.tenantId, p.meetingId);
}

/**
 * participant.update — apply an optimistic-locked patch to a participant's editable fields
 * (Req 5.1, 5.7). The resulting role assignment is re-validated against the special-invitee item
 * scoping rule before the write; a violation is a permanent error → DLQ. A stale version surfaces
 * as a VersionConflict (409-equivalent).
 */
async function handleParticipantUpdate(msg: CommandEnvelope<ParticipantUpdatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const participant = await getParticipant(tx, p.participantId, msg.tenantId, p.meetingId);
    if (!participant) {
      throw new NonRetryableError(`participant ${p.participantId} not found on meeting ${p.meetingId}`);
    }

    // Validate the RESULTING role assignment (final role + final item scope), Req 5.1, 5.7.
    const finalRole = p.patch.role ?? participant.role;
    const finalAgendaItemIds =
      p.patch.agendaItemIds !== undefined ? p.patch.agendaItemIds : (participant.agendaItemIds ?? null);
    try {
      assertValidRoleAssignment({ role: finalRole, agendaItemIds: finalAgendaItemIds });
    } catch (err) {
      asNonRetryable(err);
    }

    // Build the update set from ONLY the provided patch fields (undefined = leave unchanged).
    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    if (p.patch.role !== undefined) set.role = p.patch.role;
    if (p.patch.isMandatory !== undefined) set.isMandatory = p.patch.isMandatory;
    if (p.patch.attendanceMode !== undefined) set.attendanceMode = p.patch.attendanceMode;
    if (p.patch.agendaItemIds !== undefined) set.agendaItemIds = p.patch.agendaItemIds;
    if (p.patch.personalEmail !== undefined) set.personalEmail = p.patch.personalEmail;
    if (p.patch.personalPhone !== undefined) set.personalPhone = p.patch.personalPhone;

    await versionedUpdate(tx, participants, {
      id: p.participantId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "participant",
    });

    await enqueue(tx, {
      topic: EVENTS.participantUpdated,
      eventType: EVENTS.participantUpdated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, participantId: p.participantId },
    });
    await audit(tx, msg, "participant_update", p.participantId);
  });
  await invalidateParticipants(msg.tenantId, p.meetingId);
}

/**
 * participant.remove — delete a participant association from a meeting (Req 5.1), version-guarded.
 * A participant row is a meeting↔employee link (no soft-delete column exists on the table), so the
 * association is removed with a `WHERE version = $expected` guard; a stale version → DLQ.
 */
async function handleParticipantRemove(msg: CommandEnvelope<ParticipantRemovePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const participant = await getParticipant(tx, p.participantId, msg.tenantId, p.meetingId);
    if (!participant) {
      throw new NonRetryableError(`participant ${p.participantId} not found on meeting ${p.meetingId}`);
    }

    const deleted = await tx
      .delete(participants)
      .where(
        and(
          eq(participants.id, p.participantId),
          eq(participants.tenantId, msg.tenantId),
          eq(participants.meetingId, p.meetingId),
          eq(participants.version, p.version),
        ),
      )
      .returning({ id: participants.id });
    if (deleted.length === 0) {
      throw new NonRetryableError(
        `optimistic lock conflict removing participant ${p.participantId} (expected version ${p.version})`,
      );
    }

    await enqueue(tx, {
      topic: EVENTS.participantRemoved,
      eventType: EVENTS.participantRemoved,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, participantId: p.participantId },
    });
    await audit(tx, msg, "participant_remove", p.participantId, p.reason ? { reason: p.reason } : undefined);
  });
  await invalidateParticipants(msg.tenantId, p.meetingId);
}

/**
 * participant.respond — record the RSVP (Req 5.2, 5.6), notify the secretary on a decline, and
 * re-check the 48-hour quorum threshold (Req 5.3, 5.4). Optimistic-locked on the row's current
 * version (read-then-guarded-update inside the same tx).
 */
async function handleParticipantRespond(msg: CommandEnvelope<ParticipantRespondPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const participant = await getParticipant(tx, p.participantId, msg.tenantId, p.meetingId);
    if (!participant) {
      throw new NonRetryableError(`participant ${p.participantId} not found on meeting ${p.meetingId}`);
    }

    let status: ReturnType<typeof resolveRsvp>;
    try {
      status = resolveRsvp({ response: p.response, declineReason: p.declineReason ?? null });
    } catch (err) {
      asNonRetryable(err);
    }

    const isDecline = p.response === "decline";
    await versionedUpdate(tx, participants, {
      id: p.participantId,
      tenantId: msg.tenantId,
      expectedVersion: participant.version,
      set: {
        invitationStatus: status,
        declineReason: isDecline ? (p.declineReason ?? null) : null,
        ...(p.attendanceMode !== undefined ? { attendanceMode: p.attendanceMode } : {}),
        updatedBy: msg.actorId,
        updatedAt: new Date(),
      },
      entity: "participant",
    });

    await enqueue(tx, {
      topic: EVENTS.participantResponded,
      eventType: EVENTS.participantResponded,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        meetingId: p.meetingId,
        participantId: p.participantId,
        response: p.response,
        ...(isDecline && p.declineReason ? { declineReason: p.declineReason } : {}),
      },
    });

    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);

    // Req 5.6: a decline is surfaced to the secretary for rescheduling consideration.
    if (isDecline && meeting?.secretaryId) {
      await notify(tx, msg, {
        eventType: EVENTS.participantResponded,
        recipientId: meeting.secretaryId,
        channel: "email",
        variables: { meetingId: p.meetingId, participantId: p.participantId, response: p.response },
      });
    }

    // Req 5.3, 5.4: real-time quorum confirmation + 48-hour under-quorum alert.
    if (meeting) await checkQuorumAlert(tx, msg, meeting);

    await audit(tx, msg, "participant_respond", p.participantId, { response: p.response });
  });
  await invalidateParticipants(msg.tenantId, p.meetingId);
}

/**
 * participant.nominate — validate the nominee against the committee's approved nominee list
 * (active committee members) and record the designation (Req 5.5). A validation failure or a
 * nominee outside the approved list is a permanent error → DLQ.
 */
async function handleParticipantNominate(msg: CommandEnvelope<ParticipantNominatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const participant = await getParticipant(tx, p.participantId, msg.tenantId, p.meetingId);
    if (!participant) {
      throw new NonRetryableError(`participant ${p.participantId} not found on meeting ${p.meetingId}`);
    }
    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) {
      throw new NonRetryableError(`meeting ${p.meetingId} not found`);
    }

    // The approved nominee list is the committee's active member roster (Req 5.5).
    const approvedNomineeIds = meeting.committeeId
      ? (
          await tx
            .select({ memberId: committeeMembers.memberId })
            .from(committeeMembers)
            .where(
              and(
                eq(committeeMembers.tenantId, msg.tenantId),
                eq(committeeMembers.committeeId, meeting.committeeId),
                eq(committeeMembers.status, "active"),
              ),
            )
        ).map((m) => m.memberId)
      : [];

    try {
      assertNomineeAllowed({
        participantRole: participant.role,
        participantEmployeeId: participant.employeeId,
        nomineeId: p.nomineeId,
        approvedNomineeIds,
      });
    } catch (err) {
      // Domain raises typed HttpError; both the 400 (validation) and 422 (not in list) cases
      // are permanent — a redelivery would fail identically, so route them to the DLQ.
      if (err instanceof HttpError) {
        throw new NonRetryableError(err.message, err);
      }
      throw err;
    }

    await versionedUpdate(tx, participants, {
      id: p.participantId,
      tenantId: msg.tenantId,
      expectedVersion: participant.version,
      set: { nomineeId: p.nomineeId, updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "participant",
    });

    // Inform the nominated alternate they have been designated (addressed by id — no PII).
    await notify(tx, msg, {
      eventType: EVENTS.participantResponded,
      recipientId: p.nomineeId,
      channel: "email",
      variables: { meetingId: p.meetingId, participantId: p.participantId },
    });
    await audit(tx, msg, "participant_nominate", p.participantId, { nomineeId: p.nomineeId });
  });
  await invalidateParticipants(msg.tenantId, p.meetingId);
}

/**
 * meeting.invitations.send — fan out a `notification.send` per targeted participant per channel
 * (email + SMS + push by default, with an ICS attachment on the email) and emit
 * `meeting.participant.invited` per participant (Req 5.2). Declined participants are skipped.
 */
async function handleInvitationsSend(msg: CommandEnvelope<InvitationsSendPayload>): Promise<void> {
  const p = msg.payload;
  const channels = p.channels && p.channels.length > 0 ? p.channels : [...DEFAULT_INVITE_CHANNELS];
  const targetIds = p.participantIds && p.participantIds.length > 0 ? new Set(p.participantIds) : null;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) {
      throw new NonRetryableError(`meeting ${p.meetingId} not found`);
    }

    const roster = await tx
      .select({
        id: participants.id,
        employeeId: participants.employeeId,
        invitationStatus: participants.invitationStatus,
      })
      .from(participants)
      .where(and(eq(participants.tenantId, msg.tenantId), eq(participants.meetingId, p.meetingId)));

    const recipients = roster.filter(
      (r) => r.invitationStatus !== "declined" && (targetIds === null || targetIds.has(r.id)),
    );

    const baseVariables: Record<string, string> = {
      meetingId: meeting.id,
      title: meeting.title,
      ...(meeting.scheduledAt ? { scheduledAt: meeting.scheduledAt.toISOString() } : {}),
      ...(meeting.venue ? { venue: meeting.venue } : {}),
    };
    // ICS calendar attachment rides on the email channel (Req 5.2). Requires a scheduled time.
    const ics =
      meeting.scheduledAt !== null
        ? buildIcs({
            id: meeting.id,
            title: meeting.title,
            scheduledAt: meeting.scheduledAt,
            durationMinutes: meeting.durationMinutes,
            venue: meeting.venue,
          })
        : null;

    for (const r of recipients) {
      for (const channel of channels) {
        const variables =
          channel === "email" && ics ? { ...baseVariables, ics } : baseVariables;
        await notify(tx, msg, {
          eventType: EVENTS.participantInvited,
          recipientId: r.employeeId,
          channel,
          variables,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.participantInvited,
        eventType: EVENTS.participantInvited,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { meetingId: p.meetingId, participantId: r.id, channels },
      });
    }
    await audit(tx, msg, "invitations_send", p.meetingId, { recipientCount: recipients.length });
  });
  await invalidateParticipants(msg.tenantId, p.meetingId);
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every participant command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the participant COMMANDS topics to the handlers above.
 */
export function registerParticipantConsumers(register: RegisterConsumer): void {
  register(COMMANDS.participantAdd, handleParticipantAdd);
  register(COMMANDS.participantUpdate, handleParticipantUpdate);
  register(COMMANDS.participantRemove, handleParticipantRemove);
  register(COMMANDS.participantRespond, handleParticipantRespond);
  register(COMMANDS.participantNominate, handleParticipantNominate);
  register(COMMANDS.invitationsSend, handleInvitationsSend);
}
