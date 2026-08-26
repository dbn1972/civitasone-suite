/**
 * decision module — SQS / RabbitMQ consumer handlers (CQRS write side, Req 11.x, 12.x, 22.x).
 *
 * Every handler follows the mandatory order (steering: Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — idempotency guard; if it returns false the
 *      message was already processed, so we skip (P30).
 *   3. Business write (INSERT, or optimistic-locked `versionedUpdate`).
 *   4. Emit domain EVENTS + an audit event into the transactional outbox (same tx, so
 *      "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through cache.
 *
 * Pure logic lives in domain.ts and is wired here to persistence:
 *   - `computeVoteResult`            — resolution outcome per majority rule (Req 11.3, P16).
 *   - `nextResolutionSequence` +
 *     `generateResolutionNumber`     — sequential per-committee-per-FY numbering (Req 11.4, P25).
 *   - `requiredResponseCount`        — circulation validity threshold (Req 12.2).
 *   - `routeDecisionEvents`          — typed ERP fan-out (Req 22.1–22.5): every decision emits the
 *                                      generic `decision.recorded` fact; ERP-routable types
 *                                      (procurement/financial/hr/project/legal) also emit a typed event.
 *
 * Money (steering: bigint paise): `financialImplication` arrives as a canonical base-10 STRING
 * (normalised by the validator) and is rebuilt to an exact `bigint` with `parseMinor` before it
 * touches the `BIGINT` column — never via a lossy JS `number`. Events carry the value back as a
 * string for the same reason.
 *
 * Post-decision workflow routing (Req 11.7, 20.8 — GFR delegation of financial powers): a
 * decision whose financial implication meets the configured counter-signature threshold is
 * flagged (`workflow_triggered = true`) and routed to Workflow_Service via a
 * `workflow.instance.create` command for the competent financial authority's counter-signature.
 *
 * Permanent (non-retryable) violations — a missing anchor meeting, an unsignable resolution, an
 * invalid DSC keystore — are re-thrown as `NonRetryableError` so they go to the DLQ instead of
 * retrying forever. Optimistic-lock conflicts surface as `VersionConflictError` (409).
 *
 * Registration: `registerDecisionConsumers(register)` maps each decision COMMANDS topic to its
 * handler; worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 22.1, 22.2, 22.3, 22.4, 22.5_
 */
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, ne, isNull, isNotNull, asc, desc, gte } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { parseMinor } from "@civitasone/schemas";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import {
  renderPdf,
  signPdfWithDsc,
  DscValidationError,
  type DscSignInput,
} from "@civitasone/render";
import { db } from "../../shared/db.js";
import { cache, storage } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { meetings } from "../meeting-core/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import { votes } from "../voting/schema.js";
import { attendanceRecords } from "../attendance/schema.js";
import { minutes } from "../minutes/schema.js";
import { isMinutesLocked } from "../minutes/domain.js";
import { countQuorumEligible, requiredQuorumCount, type QuorumRule } from "../committee/domain.js";
import { isQuorumMetAtVoteTime, assertVotesWithinPresent } from "../voting/domain.js";
import { decisions, resolutions } from "./schema.js";
import {
  computeFinancialYear,
  computeVoteResult,
  generateResolutionNumber,
  nextResolutionSequence,
  requiredResponseCount,
  routeDecisionEvents,
  assertAcyclicLineage,
  type LineageEdge,
  type MajorityRule,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const DECISION_RESOURCE = "decision";
const RESOLUTION_RESOURCE = "resolution";

/**
 * Cross-service command topic to start a Workflow_Service approval instance (Req 11.7). Hard-coded
 * as the published contract (workflow-service `COMMANDS.createInstance`) rather than imported so
 * this service keeps no build dependency on another service's source.
 */
const WORKFLOW_CREATE_INSTANCE = "workflow.instance.create";

/**
 * GFR counter-signature threshold in money MINOR units (paise). A financial decision at or above
 * this implication is routed to Workflow_Service (Req 20.8). Configurable per deployment via
 * `MEETING_GFR_FINANCIAL_THRESHOLD_MINOR`; defaults to ₹10,00,000 (10 lakh) = 100,000,000 paise.
 */
const GFR_FINANCIAL_THRESHOLD_MINOR: bigint = (() => {
  const raw = process.env.MEETING_GFR_FINANCIAL_THRESHOLD_MINOR;
  if (!raw) return 100_000_000n;
  try {
    return parseMinor(raw);
  } catch {
    return 100_000_000n;
  }
})();

// ─── Command payload contracts (mirror topics.ts + validators.ts) ───────────────

interface DecisionRecordPayload {
  decisionId: string;
  meetingId: string;
  tenantId: string;
  agendaItemId?: string;
  text: string;
  type: string;
  authority?: string;
  effectiveDate?: string;
  responsibleOfficer?: string;
  deadline?: string;
  /** Money MINOR units as a canonical base-10 string (rebuilt with parseMinor). */
  financialImplication?: string;
  currency?: string;
  linkedDecisionIds?: string[];
}

interface DecisionPatchPayload {
  text?: string;
  type?: string;
  authority?: string | null;
  effectiveDate?: string | null;
  responsibleOfficer?: string | null;
  deadline?: string | null;
  financialImplication?: string | null;
  currency?: string | null;
  status?: string;
  supersededById?: string | null;
}

interface DecisionUpdatePayload {
  meetingId: string;
  tenantId: string;
  decisionId: string;
  version: number;
  patch: DecisionPatchPayload;
}

interface ResolutionRecordPayload {
  resolutionId: string;
  meetingId: string;
  tenantId: string;
  decisionId?: string;
  text: string;
  voteType: string;
  majorityRule: MajorityRule;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  effectiveDate?: string;
}

interface ResolutionSignPayload {
  resolutionId: string;
  meetingId: string;
  tenantId: string;
  signerId: string;
}

interface CirculationInitPayload {
  resolutionId: string;
  tenantId: string;
  committeeId: string;
  text: string;
  supportingDocumentIds?: string[];
  deadline: string;
  requiredResponseRate?: number;
  majorityRule: MajorityRule;
}

interface DissentRecordPayload {
  resolutionId: string;
  meetingId: string;
  tenantId: string;
  memberId: string;
  note: string;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

/** Emit an audit fact for every mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceType: string,
  resourceId: string,
  detail?: Record<string, unknown>,
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
      resourceType,
      resourceId,
      outcome: "success",
      ...(detail ? { detail } : {}),
    },
  });
}

/** Best-effort read-cache invalidation for a resource (single key + resource list) after commit. */
async function invalidate(tenantId: string, resource: string, id: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, resource, id));
  await cache.invalidateResource(tenantId, resource);
}

/** Load a meeting row (scoped to tenant) within the tx. */
async function loadMeeting(tx: DrizzleTx, meetingId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load a resolution row (scoped to tenant) within the tx. */
async function loadResolution(tx: DrizzleTx, resolutionId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(resolutions)
    .where(and(eq(resolutions.id, resolutionId), eq(resolutions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Extract the trailing numeric sequence from a resolution number like "FC/RES/2025-26/007" → 7. */
function parseResolutionSequence(resolutionNumber: string | null): number | null {
  if (!resolutionNumber) return null;
  const tail = resolutionNumber.split("/").pop() ?? "";
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Assign a sequential resolution number scoped to (committee, financial year) (Req 11.4, P25).
 * Reads the numbers already issued in the same scope (resolutions joined to their meetings),
 * computes the next sequence via the pure `nextResolutionSequence`, and formats it via
 * `generateResolutionNumber`. The DB UNIQUE(tenant, meeting, resolution_number) constraint is
 * the final guard against a per-meeting collision; committee-FY uniqueness holds by construction.
 */
async function computeResolutionNumber(
  tx: DrizzleTx,
  args: { tenantId: string; committeeId: string | null; financialYear: string },
): Promise<string> {
  let committeeCode: string | null = null;
  if (args.committeeId) {
    const c = await tx
      .select({ code: committees.code })
      .from(committees)
      .where(and(eq(committees.id, args.committeeId), eq(committees.tenantId, args.tenantId)))
      .limit(1);
    committeeCode = c[0]?.code ?? null;
  }

  const scopeFilter = args.committeeId
    ? eq(meetings.committeeId, args.committeeId)
    : isNull(meetings.committeeId);
  const rows = await tx
    .select({ resolutionNumber: resolutions.resolutionNumber })
    .from(resolutions)
    .innerJoin(meetings, eq(resolutions.meetingId, meetings.id))
    .where(
      and(
        eq(resolutions.tenantId, args.tenantId),
        eq(meetings.financialYear, args.financialYear),
        scopeFilter,
      ),
    );

  const sequences = rows
    .map((r) => parseResolutionSequence(r.resolutionNumber))
    .filter((n): n is number => n !== null);
  const sequence = nextResolutionSequence(sequences);
  return generateResolutionNumber({ committeeCode, financialYear: args.financialYear, sequence });
}

/**
 * Resolve the meeting a circulation resolution anchors to. A circulation resolution is decided
 * outside a meeting but the `resolutions.meeting_id` FK is NOT NULL, and Req 12.7 requires passed
 * circulation resolutions to be ratified at the next formal meeting — so we anchor to the
 * committee's next upcoming (non-cancelled) meeting, falling back to the most recent one. Returns
 * null when the committee has no meeting at all (a permanent error for the caller).
 */
async function resolveCirculationMeeting(
  tx: DrizzleTx,
  tenantId: string,
  committeeId: string,
): Promise<{ meetingId: string; financialYear: string } | null> {
  const now = new Date();
  const upcoming = await tx
    .select({ id: meetings.id, financialYear: meetings.financialYear, scheduledAt: meetings.scheduledAt })
    .from(meetings)
    .where(
      and(
        eq(meetings.tenantId, tenantId),
        eq(meetings.committeeId, committeeId),
        ne(meetings.status, "cancelled"),
        gte(meetings.scheduledAt, now),
      ),
    )
    .orderBy(asc(meetings.scheduledAt))
    .limit(1);

  let row = upcoming[0];
  if (!row) {
    const recent = await tx
      .select({ id: meetings.id, financialYear: meetings.financialYear, scheduledAt: meetings.scheduledAt })
      .from(meetings)
      .where(
        and(
          eq(meetings.tenantId, tenantId),
          eq(meetings.committeeId, committeeId),
          ne(meetings.status, "cancelled"),
        ),
      )
      .orderBy(desc(meetings.scheduledAt))
      .limit(1);
    row = recent[0];
  }
  if (!row) return null;
  const financialYear = row.financialYear ?? computeFinancialYear(row.scheduledAt ?? now);
  return { meetingId: row.id, financialYear };
}

/** Count active committee members (denominator for the circulation response threshold, Req 12.2). */
async function countActiveMembers(tx: DrizzleTx, tenantId: string, committeeId: string): Promise<number> {
  const rows = await tx
    .select({ memberId: committeeMembers.memberId })
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.tenantId, tenantId),
        eq(committeeMembers.committeeId, committeeId),
        eq(committeeMembers.status, "active"),
      ),
    );
  return rows.length;
}

/**
 * Re-derive quorum LIVE at resolution-record time (Gap 2). `meeting.quorumEstablished` is a
 * ONE-WAY LATCH — attendance/consumer.ts sets it true exactly once and never clears it when members
 * simply leave (only an explicit adjourn→resume cycle resets it) — so a numbered, "effective"
 * resolution with an arbitrary invented tally could otherwise still be recorded long after every
 * real attendee has left. This is the SAME live-attendance quorum recomputation voting/consumer.ts
 * fix 11 applies at conclude (`computeVoteTimeQuorum`): count quorum-eligible present attendees and
 * the committee's required quorum through the shared committee-domain helpers, so the
 * count/percentage/VC-exclusion logic matches quorum establishment exactly. Returns null when the
 * meeting has no committee (no formal quorum rule to apply — the caller then falls back to the
 * latched flag, preserving the existing no-committee aggregate-record path).
 */
async function computeResolutionTimeQuorum(
  tx: DrizzleTx,
  meetingId: string,
  tenantId: string,
  committeeId: string | null,
): Promise<{ membersPresent: number; requiredQuorum: number } | null> {
  if (!committeeId) return null;
  const committeeRows = await tx
    .select({ quorumRule: committees.quorumRule })
    .from(committees)
    .where(and(eq(committees.id, committeeId), eq(committees.tenantId, tenantId)))
    .limit(1);
  const committee = committeeRows[0];
  if (!committee) return null;
  const rule = committee.quorumRule as QuorumRule;

  const activeMembers = await countActiveMembers(tx, tenantId, committeeId);
  const attendance = await tx
    .select({ status: attendanceRecords.status, mode: attendanceRecords.mode })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.meetingId, meetingId), eq(attendanceRecords.tenantId, tenantId)));

  const membersPresent = countQuorumEligible(attendance, rule);
  const requiredQuorum = requiredQuorumCount(rule, activeMembers);
  return { membersPresent, requiredQuorum };
}

// ─── DSC signing of the resolution document (Req 11.5) ──────────────────────────

/** Signed-resolution artifacts persisted onto the resolution row. */
interface SignedResolutionArtifacts {
  storageKey: string | null;
  /** DSC certificate SHA-256 fingerprint (the durable signature marker); null when unsigned. */
  signature: string | null;
  /** DSC signer Common Name; null when no keystore is configured. */
  signerName: string | null;
  signedAt: Date | null;
  /** SHA-256 of the canonical resolution content — QR-verifiable integrity anchor (Req 11.5). */
  hashCurrent: string;
}

/** Canonical, signature-bound representation of a resolution (number + text). */
function canonicalResolutionContent(args: { resolutionNumber: string; text: string }): string {
  return `${args.resolutionNumber}\n${args.text}`;
}

/** Minimal HTML body for the rendered/signed resolution document. */
function buildResolutionHtml(args: { resolutionNumber: string; text: string }): string {
  const esc = (s: string): string =>
    s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<title>Resolution ${esc(args.resolutionNumber)}</title></head>` +
    `<body><h1>Resolution ${esc(args.resolutionNumber)}</h1>` +
    `<p>${esc(args.text)}</p></body></html>`
  );
}

/** Read PKCS#12 DSC material from env, or null when signing is not configured (dev/test). */
async function loadDscMaterial(): Promise<DscSignInput | null> {
  const p12Path = process.env.DSC_P12_PATH;
  const passphrase = process.env.DSC_PASSPHRASE;
  if (!p12Path || !passphrase) return null;
  const p12Buffer = await readFile(p12Path);
  return { p12Buffer, passphrase };
}

/** Store the resolution PDF in object storage; best-effort (the signature + hash are the record). */
async function storeResolutionPdf(tenantId: string, resolutionId: string, buffer: Buffer): Promise<string | null> {
  const key = `meeting/${tenantId}/resolutions/${resolutionId}.pdf`;
  try {
    await storage.putObject(key, buffer, "application/pdf");
    return key;
  } catch {
    // Object storage unavailable — the document can be re-rendered from the immutable resolution
    // content on demand, so we do not fail the sign write over a storage hiccup.
    return null;
  }
}

/**
 * Render the resolution to a PDF and apply the chairperson's DSC (Req 11.5). When a keystore is
 * configured (DSC_P12_PATH / DSC_PASSPHRASE) the PKCS#7 detached signature is applied and the
 * signer metadata captured; otherwise the (unsigned) document is stored with only the integrity
 * hash so we never claim a signature we did not apply. A configured-but-invalid keystore is a
 * permanent failure (→ DLQ).
 */
async function signResolutionDocument(args: {
  tenantId: string;
  resolutionId: string;
  resolutionNumber: string;
  text: string;
}): Promise<SignedResolutionArtifacts> {
  const hashCurrent = createHash("sha256").update(canonicalResolutionContent(args)).digest("hex");

  let pdf: Buffer;
  try {
    const rendered = await renderPdf({ html: buildResolutionHtml(args) });
    pdf = rendered.buffer;
  } catch {
    pdf = Buffer.from(buildResolutionHtml(args), "utf-8");
  }

  const dsc = await loadDscMaterial();
  if (!dsc) {
    const storageKey = await storeResolutionPdf(args.tenantId, args.resolutionId, pdf);
    return { storageKey, signature: null, signerName: null, signedAt: null, hashCurrent };
  }

  let signed;
  try {
    signed = await signPdfWithDsc(pdf, dsc);
  } catch (err) {
    const detail = err instanceof DscValidationError ? `${err.code}: ${err.message}` : String(err);
    throw new NonRetryableError(`DSC signing failed for resolution ${args.resolutionId}: ${detail}`, err);
  }

  const storageKey = await storeResolutionPdf(args.tenantId, args.resolutionId, signed.buffer);
  return {
    storageKey,
    signature: signed.sha256Fingerprint,
    signerName: signed.signerCN,
    signedAt: new Date(signed.signedAt),
    hashCurrent,
  };
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * decision.record → INSERT decision + typed ERP fan-out (Req 22.1–22.5) + optional GFR
 * counter-signature routing (Req 11.7, 20.8). Money rebuilt with `parseMinor`.
 */
async function handleDecisionRecord(msg: CommandEnvelope<DecisionRecordPayload>): Promise<void> {
  const p = msg.payload;
  const financial = p.financialImplication !== undefined ? parseMinor(p.financialImplication) : null;
  const currency = p.currency ?? "INR";
  // Req 20.8: a financial decision at/above the GFR delegation threshold needs counter-signature.
  const routeToWorkflow = financial !== null && financial >= GFR_FINANCIAL_THRESHOLD_MINOR;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    await tx.insert(decisions).values({
      id: p.decisionId,
      tenantId: p.tenantId,
      meetingId: p.meetingId,
      agendaItemId: p.agendaItemId ?? null,
      text: p.text,
      type: p.type,
      authority: p.authority ?? null,
      effectiveDate: p.effectiveDate ?? null,
      status: "effective",
      responsibleOfficer: p.responsibleOfficer ?? null,
      deadline: p.deadline ? new Date(p.deadline) : null,
      financialImplication: financial,
      currency,
      linkedDecisionIds: p.linkedDecisionIds ?? null,
      workflowTriggered: routeToWorkflow,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    // Typed ERP fan-out: generic `decision.recorded` first, then the type-specific event (if any).
    const financialStr = financial !== null ? financial.toString() : undefined;
    for (const topic of routeDecisionEvents(p.type)) {
      const payload =
        topic === EVENTS.decisionRecorded
          ? {
              decisionId: p.decisionId,
              meetingId: p.meetingId,
              type: p.type,
              ...(financialStr !== undefined ? { financialImplication: financialStr, currency } : {}),
            }
          : {
              decisionId: p.decisionId,
              meetingId: p.meetingId,
              text: p.text,
              ...(p.authority ? { authority: p.authority } : {}),
              ...(p.effectiveDate ? { effectiveDate: p.effectiveDate } : {}),
              ...(financialStr !== undefined ? { financialImplication: financialStr, currency } : {}),
            };
      await enqueue(tx, {
        topic,
        eventType: topic,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload,
      });
    }

    // Post-decision workflow routing (Req 11.7): counter-signature by the competent authority.
    if (routeToWorkflow) {
      await enqueue(tx, {
        topic: WORKFLOW_CREATE_INSTANCE,
        eventType: WORKFLOW_CREATE_INSTANCE,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: randomUUID(),
          tenantId: msg.tenantId,
          name: `Financial counter-signature — decision ${p.decisionId}`,
          status: "active",
          version: 1,
          initialTaskName: "Counter-signature",
          definitionCode: "meeting_financial_countersignature",
          refType: "meeting_decision",
          refId: p.decisionId,
          context: {
            meetingId: p.meetingId,
            decisionType: p.type,
            ...(financialStr !== undefined ? { financialImplication: financialStr, currency } : {}),
            ...(p.authority ? { authority: p.authority } : {}),
          },
        },
      });
    }

    await audit(tx, msg, "record", "decision", p.decisionId, {
      type: p.type,
      ...(routeToWorkflow ? { workflowTriggered: true } : {}),
    });
  });

  await invalidate(msg.tenantId, DECISION_RESOURCE, p.meetingId);
}

/** decision.update → optimistic-locked field patch (Req 11.8). Money rebuilt with `parseMinor`. */
async function handleDecisionUpdate(msg: CommandEnvelope<DecisionUpdatePayload>): Promise<void> {
  const p = msg.payload;

  // A decision cannot supersede itself (would create a self-loop in the lineage graph, Req 11.8).
  if (p.patch.supersededById != null && p.patch.supersededById === p.decisionId) {
    throw new NonRetryableError(`decision ${p.decisionId} cannot supersede itself`);
  }

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const rows = await tx
      .select({ id: decisions.id, meetingId: decisions.meetingId })
      .from(decisions)
      .where(and(eq(decisions.id, p.decisionId), eq(decisions.tenantId, msg.tenantId)))
      .limit(1);
    const existing = rows[0];
    if (!existing) return;

    const patch = p.patch;

    // Fix (Gap 3 — supersession must survive the minutes lock): a supersede-ONLY patch (only
    // status:"superseded" and/or supersededById, touching NO substantive field) is exempt from the
    // minutes-lock guard below. Superseding a minuted decision — which fix 9 supports, and which
    // normally happens at a LATER meeting — only ADDS a forward supersession pointer; it does not
    // rewrite the substance the locked minutes recorded. Any patch that touches a substantive field
    // (text/type/authority/effectiveDate/responsibleOfficer/deadline/financialImplication/currency),
    // or changes status to anything OTHER than "superseded", stays blocked once minutes are locked.
    // The supersede path further down STILL enforces fix 9's target-exists + acyclic-lineage checks.
    const substantivePatchFields = [
      "text",
      "type",
      "authority",
      "effectiveDate",
      "responsibleOfficer",
      "deadline",
      "financialImplication",
      "currency",
    ] as const;
    const touchesSubstantiveField = substantivePatchFields.some((f) => patch[f] !== undefined);
    const changesStatusToNonSuperseded = patch.status !== undefined && patch.status !== "superseded";
    const isSupersedeOnlyPatch = !touchesSubstantiveField && !changesStatusToNonSuperseded;

    // Fix (decision amendable after its minutes are signed): once a meeting's minutes are
    // approved/signed/circulated, the decisions they recorded must not be silently rewritten —
    // the legally-binding, hash-anchored minutes and the "live" decision record would otherwise
    // permanently disagree with nothing surfacing it. Mirrors minutes/consumer.ts's own
    // `assertMinutesEditable` guard, applied from the decision side since this handler previously
    // never queried `minutes` at all. A supersede-only patch (above) is exempt — it appends a
    // forward supersession pointer without a substantive rewrite (Gap 3).
    const minutesRows = await tx
      .select({ status: minutes.status })
      .from(minutes)
      .where(and(eq(minutes.meetingId, existing.meetingId), eq(minutes.tenantId, msg.tenantId)));
    if (!isSupersedeOnlyPatch && minutesRows.some((m) => isMinutesLocked(m.status))) {
      throw new NonRetryableError(
        `decision ${p.decisionId} cannot be amended: its meeting's minutes are already approved/signed/circulated`,
      );
    }

    // Fix (decision.status/resolution-outcome drift): a decision cannot be marked "effective"
    // while its own linked resolution's real, voting-computed outcome says otherwise — "passed"
    // is the only outcome consistent with "effective" (a linked "rejected"/"invalid" resolution
    // would openly contradict it in the official minutes). A decision with no linked resolution
    // at all is unaffected (not every decision arises from a formal vote).
    if (patch.status === "effective") {
      const linkedResolutions = await tx
        .select({ result: resolutions.result })
        .from(resolutions)
        .where(and(eq(resolutions.tenantId, msg.tenantId), eq(resolutions.decisionId, p.decisionId)));
      const contradicted = linkedResolutions.some((r) => r.result !== "passed");
      if (contradicted) {
        throw new NonRetryableError(
          `decision ${p.decisionId} cannot be marked effective: its linked resolution did not pass`,
        );
      }
    }

    // Fix (acyclic-lineage guard never wired in + dangling supersededById): `supersededById`
    // must reference a real, same-tenant decision, and the new edge must keep the decision
    // register's supersedes graph acyclic — domain.ts already implements and unit-tests this
    // guard (`assertAcyclicLineage`/`wouldCreateCycle`), it was simply never called from here.
    if (patch.supersededById != null) {
      const target = await tx
        .select({ id: decisions.id })
        .from(decisions)
        .where(and(eq(decisions.id, patch.supersededById), eq(decisions.tenantId, msg.tenantId)))
        .limit(1);
      if (target.length === 0) {
        throw new NonRetryableError(
          `decision ${p.decisionId} cannot supersede unknown decision ${patch.supersededById}`,
        );
      }

      const edgeRows = await tx
        .select({ id: decisions.id, supersededById: decisions.supersededById })
        .from(decisions)
        .where(
          and(
            eq(decisions.tenantId, msg.tenantId),
            ne(decisions.id, p.decisionId),
            isNotNull(decisions.supersededById),
          ),
        );
      const existingLineage: LineageEdge[] = edgeRows
        .filter((r): r is { id: string; supersededById: string } => r.supersededById != null)
        .map((r) => ({ from: r.id, to: r.supersededById, relation: "supersedes" }));

      try {
        assertAcyclicLineage(existingLineage, { from: p.decisionId, to: patch.supersededById, relation: "supersedes" });
      } catch (err) {
        throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
      }
    }

    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    if (patch.text !== undefined) set.text = patch.text;
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.authority !== undefined) set.authority = patch.authority;
    if (patch.effectiveDate !== undefined) set.effectiveDate = patch.effectiveDate;
    if (patch.responsibleOfficer !== undefined) set.responsibleOfficer = patch.responsibleOfficer;
    if (patch.deadline !== undefined) set.deadline = patch.deadline === null ? null : new Date(patch.deadline);
    if (patch.currency !== undefined) set.currency = patch.currency;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.supersededById !== undefined) set.supersededById = patch.supersededById;
    if (patch.financialImplication !== undefined) {
      set.financialImplication = patch.financialImplication === null ? null : parseMinor(patch.financialImplication);
    }

    await versionedUpdate(tx, decisions, {
      id: p.decisionId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "decision",
    });
    await audit(tx, msg, "update", "decision", p.decisionId);
  });

  await invalidate(msg.tenantId, DECISION_RESOURCE, p.meetingId);
}

/**
 * resolution.record → compute result + assign sequential number + INSERT resolution + emit
 * `resolution.passed` / `resolution.rejected` (Req 11.3, 11.4).
 */
async function handleResolutionRecord(msg: CommandEnvelope<ResolutionRecordPayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) {
      throw new NonRetryableError(`meeting ${p.meetingId} not found for resolution ${p.resolutionId}`);
    }

    // Fix (resolution fabrication bypass + Gap 2 stale quorum latch): a resolution can only be
    // recorded while quorum genuinely holds. `meeting.quorumEstablished` is a ONE-WAY LATCH — set
    // true once and never cleared when members simply leave (attendance/consumer.ts) — so trusting
    // it alone let an official, numbered, "effective" resolution with an invented tally be recorded
    // after the room had actually dropped below quorum. Re-derive quorum LIVE from attendance the
    // SAME way voting's fix 11 does at conclude (computeResolutionTimeQuorum). A no-committee
    // meeting has no quorum rule to apply, so fall back to the latched flag there — unchanged for
    // the legitimate no-roster aggregate-record path (tests/resolution-fabrication-bypass.test.ts).
    const liveQuorum = await computeResolutionTimeQuorum(tx, meeting.id, msg.tenantId, meeting.committeeId);
    const quorumMet = liveQuorum ? isQuorumMetAtVoteTime(liveQuorum) : meeting.quorumEstablished;
    if (!quorumMet) {
      throw new NonRetryableError(
        `resolution ${p.resolutionId} cannot be recorded: quorum is not currently met for meeting ${p.meetingId}`,
      );
    }

    // Don't blindly trust client-supplied vote counts: when real, per-member ballots already
    // exist for this resolution (meeting.votes — the voting module's tracked-ballot flow used
    // for roll_call/electronic_poll), the tally is computed from THOSE rows, never from the
    // client. Only when no such rows exist — the legitimate case for an aggregate-only vote type
    // (show_of_hands/secret_ballot), where the secretary manually records the count the chair
    // read out — is the client-supplied count used, and only now that quorum is verified above.
    const realVoteRows = await tx
      .select({ position: votes.position })
      .from(votes)
      .where(and(eq(votes.resolutionId, p.resolutionId), eq(votes.tenantId, msg.tenantId)));
    const tally =
      realVoteRows.length > 0
        ? realVoteRows.reduce(
            (acc, v) => {
              if (v.position === "for") acc.votesFor += 1;
              else if (v.position === "against") acc.votesAgainst += 1;
              else acc.votesAbstain += 1;
              return acc;
            },
            { votesFor: 0, votesAgainst: 0, votesAbstain: 0 },
          )
        : { votesFor: p.votesFor, votesAgainst: p.votesAgainst, votesAbstain: p.votesAbstain };

    // Fix (Gap 2 — bound the client tally against the live headcount): on the aggregate fallback
    // path (no real meeting.votes rows — the show_of_hands/secret_ballot case where the client tally
    // is trusted verbatim), a claimed tally can never exceed the members actually present. Enforce
    // the same P15 invariant voting applies at conclude (assertVotesWithinPresent), bounding the
    // TOTAL claimed positions (for + against + abstain) against the live present-member headcount.
    // Only when the meeting is committee-backed (liveQuorum non-null yields a real headcount): a
    // no-committee meeting has no roster to bound against, so that path is left unchanged.
    if (realVoteRows.length === 0 && liveQuorum) {
      const claimedTotal = tally.votesFor + tally.votesAgainst + tally.votesAbstain;
      try {
        assertVotesWithinPresent(claimedTotal, liveQuorum.membersPresent);
      } catch (err) {
        throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
      }
    }

    const financialYear = meeting.financialYear ?? computeFinancialYear(meeting.scheduledAt ?? new Date());
    const resolutionNumber = await computeResolutionNumber(tx, {
      tenantId: msg.tenantId,
      committeeId: meeting.committeeId,
      financialYear,
    });

    const result = computeVoteResult(tally, p.majorityRule);

    await tx.insert(resolutions).values({
      id: p.resolutionId,
      tenantId: p.tenantId,
      meetingId: p.meetingId,
      decisionId: p.decisionId ?? null,
      resolutionNumber,
      text: p.text,
      voteType: p.voteType,
      votesFor: tally.votesFor,
      votesAgainst: tally.votesAgainst,
      votesAbstain: tally.votesAbstain,
      majorityRule: p.majorityRule,
      result,
      effectiveDate: p.effectiveDate ?? null,
      status: "effective",
      isCirculation: false,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    const topic = result === "passed" ? EVENTS.resolutionPassed : EVENTS.resolutionRejected;
    await enqueue(tx, {
      topic,
      eventType: topic,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        resolutionId: p.resolutionId,
        meetingId: p.meetingId,
        resolutionNumber,
        votesFor: tally.votesFor,
        votesAgainst: tally.votesAgainst,
        votesAbstain: tally.votesAbstain,
      },
    });
    await audit(tx, msg, "record", "resolution", p.resolutionId, { result, resolutionNumber });
  });

  await invalidate(msg.tenantId, RESOLUTION_RESOURCE, p.meetingId);
}

/** resolution.sign → render + DSC-sign the passed resolution + emit `resolution.signed` (Req 11.5). */
async function handleResolutionSign(msg: CommandEnvelope<ResolutionSignPayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const resolution = await loadResolution(tx, p.resolutionId, msg.tenantId);
    if (!resolution) {
      throw new NonRetryableError(`resolution ${p.resolutionId} not found`);
    }
    // Only a passed resolution is signed (Req 11.5).
    if (resolution.result !== "passed") {
      throw new NonRetryableError(
        `resolution ${p.resolutionId} is "${resolution.result}"; only passed resolutions can be signed`,
      );
    }

    const artifacts = await signResolutionDocument({
      tenantId: msg.tenantId,
      resolutionId: p.resolutionId,
      resolutionNumber: resolution.resolutionNumber,
      text: resolution.text,
    });

    await versionedUpdate(tx, resolutions, {
      id: p.resolutionId,
      tenantId: msg.tenantId,
      expectedVersion: resolution.version,
      set: {
        dscSignature: artifacts.signature,
        dscSignerName: artifacts.signerName,
        dscSignedAt: artifacts.signedAt,
        hashCurrent: artifacts.hashCurrent,
        storageKey: artifacts.storageKey,
        updatedBy: msg.actorId,
        updatedAt: new Date(),
      },
      entity: "resolution",
    });

    await enqueue(tx, {
      topic: EVENTS.resolutionSigned,
      eventType: EVENTS.resolutionSigned,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        resolutionId: p.resolutionId,
        meetingId: resolution.meetingId,
        dscSignerName: artifacts.signerName,
        hashCurrent: artifacts.hashCurrent,
      },
    });
    await audit(tx, msg, "sign", "resolution", p.resolutionId, { signerId: p.signerId });
  });

  await invalidate(msg.tenantId, RESOLUTION_RESOURCE, p.meetingId);
}

/**
 * resolution.circulation_init → create a circulation resolution, anchor it to the committee's
 * next/most-recent meeting, and distribute the proposal to all active members (Req 12.1, 12.2).
 * The outcome stays provisional (`result = "invalid"`, i.e. not yet a valid passed/rejected) with
 * `response_rate` NULL until the deadline/close step computes it via `computeCirculationResult`.
 */
async function handleResolutionCirculationInit(msg: CommandEnvelope<CirculationInitPayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const anchor = await resolveCirculationMeeting(tx, msg.tenantId, p.committeeId);
    if (!anchor) {
      throw new NonRetryableError(
        `committee ${p.committeeId} has no meeting to anchor a circulation resolution to`,
      );
    }

    const resolutionNumber = await computeResolutionNumber(tx, {
      tenantId: msg.tenantId,
      committeeId: p.committeeId,
      financialYear: anchor.financialYear,
    });

    // Response threshold denominator (Req 12.2) — recorded for the status view via requiredCount.
    const totalMembers = await countActiveMembers(tx, msg.tenantId, p.committeeId);
    const requiredCount = requiredResponseCount(
      totalMembers,
      p.requiredResponseRate !== undefined ? { minResponseRatePct: p.requiredResponseRate } : undefined,
    );

    await tx.insert(resolutions).values({
      id: p.resolutionId,
      tenantId: msg.tenantId,
      meetingId: anchor.meetingId,
      resolutionNumber,
      text: p.text,
      voteType: "circulation_resolution",
      majorityRule: p.majorityRule,
      // Provisional until the deadline/close computes the final outcome (Req 12.4).
      result: "invalid",
      status: "effective",
      isCirculation: true,
      circulationDeadline: new Date(p.deadline),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    // Distribute the proposal to every active committee member (Req 12.1) and track responses via
    // the votes table (the voting module's circulation-respond handler). recipientId carries the
    // member id; notification-service resolves the delivery address (no PII crosses this boundary).
    const members = await tx
      .select({ memberId: committeeMembers.memberId })
      .from(committeeMembers)
      .where(
        and(
          eq(committeeMembers.tenantId, msg.tenantId),
          eq(committeeMembers.committeeId, p.committeeId),
          eq(committeeMembers.status, "active"),
        ),
      );
    for (const m of members) {
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: COMMANDS.resolutionCirculationInit,
          recipient: m.memberId,
          recipientId: m.memberId,
          channel: "in_app",
          variables: { resolutionId: p.resolutionId, resolutionNumber, deadline: p.deadline },
        }),
      });
    }

    await audit(tx, msg, "circulation_init", "resolution", p.resolutionId, {
      committeeId: p.committeeId,
      totalMembers,
      requiredCount,
    });
  });

  await invalidate(msg.tenantId, RESOLUTION_RESOURCE, p.resolutionId);
}

/**
 * dissent.record → attach a recorded dissent note to a resolution (Req 11.6). To preserve the
 * vote-count invariant (P14: `count(votes) == votes_for + votes_against + votes_abstain`) and the
 * unique-vote guard (P17), we do NOT insert a new votes row: if the member already recorded a
 * vote we attach the note to that row's `reason`; either way the dissent is captured durably in
 * the audit trail (the annexure source the minutes module includes with the signed minutes).
 */
async function handleDissentRecord(msg: CommandEnvelope<DissentRecordPayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const resolution = await loadResolution(tx, p.resolutionId, msg.tenantId);
    if (!resolution) {
      throw new NonRetryableError(`resolution ${p.resolutionId} not found for dissent note`);
    }

    const existing = await tx
      .select({ id: votes.id })
      .from(votes)
      .where(
        and(
          eq(votes.tenantId, msg.tenantId),
          eq(votes.resolutionId, p.resolutionId),
          eq(votes.memberId, p.memberId),
        ),
      )
      .limit(1);
    const existingVote = existing[0];
    if (existingVote) {
      await tx
        .update(votes)
        .set({ reason: p.note })
        .where(and(eq(votes.id, existingVote.id), eq(votes.tenantId, msg.tenantId)));
    }

    // Durable annexure record (Req 11.6): the dissent note is a governance record, not PII.
    await audit(tx, msg, "dissent_record", "resolution", p.resolutionId, {
      memberId: p.memberId,
      note: p.note,
      attachedToVote: Boolean(existingVote),
    });
  });

  await invalidate(msg.tenantId, RESOLUTION_RESOURCE, p.meetingId);
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every decision/resolution command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the decision COMMANDS topics to the handlers above.
 */
export function registerDecisionConsumers(register: RegisterConsumer): void {
  register(COMMANDS.decisionRecord, handleDecisionRecord);
  register(COMMANDS.decisionUpdate, handleDecisionUpdate);
  register(COMMANDS.resolutionRecord, handleResolutionRecord);
  register(COMMANDS.resolutionSign, handleResolutionSign);
  register(COMMANDS.resolutionCirculationInit, handleResolutionCirculationInit);
  register(COMMANDS.dissentRecord, handleDissentRecord);
}
