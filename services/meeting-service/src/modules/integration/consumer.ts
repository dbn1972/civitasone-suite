/**
 * integration module — cross-service CONSUMED_EVENTS handlers (CQRS write side).
 *
 * meeting-service subscribes to a handful of events OWNED BY OTHER SERVICES to stitch
 * cross-service behaviour (topics.ts `CONSUMED_EVENTS`). Unlike the 13 domain modules —
 * each of which owns its COMMANDS — this module owns no schema of its own; it reacts to
 * facts published elsewhere and mutates the existing meeting-schema tables.
 *
 * The five consumed events (design "Integration Points"):
 *   1. tenant.tenant.created   → auto-provision the tenant's default meeting-type catalogue
 *                                (Req 1.7 config bootstrap). Idempotent via a UNIQUE
 *                                (tenant_id, code) index + ON CONFLICT DO NOTHING.
 *   2. workflow.task.completed → advance minutes / resolution approval state when the
 *                                Workflow_Service approval chain finishes (Req 7.3).
 *   3. workflow.task.assigned  → surface a freshly-assigned approval in the assignee's
 *                                pending-tasks view by invalidating its read cache (Req 22.6).
 *   4. hrms.employee.updated   → refresh the participant / committee read caches so the
 *                                directory reflects the new designation / reporting line.
 *   5. hrms.employee.separated → expire the separated employee's active committee
 *                                memberships (Req 2.4) and flag their still-open action
 *                                items for reassignment (Req 9.3).
 *
 * Idempotency & tolerance (steering + design P30): every handler that MUTATES the DB calls
 * `markProcessed(tx, msg.messageId)` FIRST and skips on redelivery; handlers that only
 * invalidate caches are naturally idempotent and skip the inbox write. Every handler
 * tolerates unknown / additional payload fields (forward-compatible cross-service contract)
 * and treats a malformed-but-known event as a permanent (DLQ) `NonRetryableError` rather
 * than looping.
 *
 * Registration: `registerIntegrationConsumers(register)` maps each CONSUMED_EVENTS topic to
 * its handler; worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 1.7, 2.4, 7.3, 9.3, 15.2_
 */
import { and, eq, inArray } from "drizzle-orm";
import { pino } from "pino";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS, SERVICE } from "../../topics.js";
import { meetingTypes } from "../meeting-core/schema.js";
import { minutes } from "../minutes/schema.js";
import { resolutions } from "../decision/schema.js";
import { committeeMembers } from "../committee/schema.js";
import { actionItems } from "../action-item/schema.js";

const log = pino({ name: "meeting-integration-consumer" });

/** Nil-UUID actor for system-initiated (cross-service) writes — carries no human actor. */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const AUDIT_TOPIC = "audit.event.record";

// ─── Consumed-event payload contracts (mirror topics.ts JSDoc) ─────────────────

interface TenantCreatedPayload {
  tenantId: string;
  name?: string;
  orgType?: string;
  residency?: string;
}

interface WorkflowTaskCompletedPayload {
  taskId: string;
  workflowInstanceId?: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  outcome: string;
  actorId?: string;
  completedAt?: string;
}

interface WorkflowTaskAssignedPayload {
  taskId: string;
  workflowInstanceId?: string;
  tenantId: string;
  assigneeId: string;
  entityType?: string;
  entityId?: string;
  dueAt?: string;
}

interface HrmsEmployeeUpdatedPayload {
  employeeId: string;
  tenantId: string;
  changedFields?: string[];
  designation?: string;
  reportingOfficerId?: string;
}

interface HrmsEmployeeSeparatedPayload {
  employeeId: string;
  tenantId: string;
  separationDate?: string;
  reason?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

/** Emit an audit fact for a cross-service-driven mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: SERVICE, action, resourceType, resourceId, outcome: "success" },
  });
}

/** Wrap a permanent domain violation as a non-retryable (straight-to-DLQ) error. */
function asPermanent(err: unknown): never {
  throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
}

/** Normalize a workflow outcome string into approve / reject / unknown. */
function classifyOutcome(outcome: string): "approve" | "reject" | "unknown" {
  const o = outcome.trim().toLowerCase();
  if (["approve", "approved", "accept", "accepted"].includes(o)) return "approve";
  if (["reject", "rejected", "return", "returned", "declined", "deny", "denied"].includes(o)) return "reject";
  return "unknown";
}

// ─── Default meeting-type catalogue (Req 1.7 — tenant config bootstrap) ─────────

/**
 * The default meeting types every tenant starts with. Codes are unique per tenant
 * (`UNIQUE(tenant_id, code)`), so re-provisioning is a no-op (ON CONFLICT DO NOTHING).
 * `isStatutory` types (board / finance committee) feed the statutory-frequency sweep.
 */
const DEFAULT_MEETING_TYPES: ReadonlyArray<{
  code: string;
  name: string;
  isStatutory: boolean;
  frequency: string | null;
}> = [
  { code: "board",             name: "Board Meeting",              isStatutory: true,  frequency: "quarterly" },
  { code: "committee",         name: "Committee Meeting",          isStatutory: false, frequency: "monthly" },
  { code: "finance_committee", name: "Finance Committee Meeting",  isStatutory: true,  frequency: "quarterly" },
  { code: "departmental",      name: "Departmental Meeting",       isStatutory: false, frequency: "monthly" },
  { code: "ad_hoc",            name: "Ad-hoc Meeting",             isStatutory: false, frequency: null },
  { code: "statutory",         name: "Statutory Meeting",          isStatutory: true,  frequency: "annually" },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * tenant.tenant.created → auto-provision the default meeting-type catalogue for the new
 * tenant (Req 1.7). Idempotent twice over: `markProcessed` skips a redelivered event, and
 * `onConflictDoNothing` on the (tenant_id, code) unique index makes a partial re-run safe.
 */
async function handleTenantCreated(msg: CommandEnvelope<TenantCreatedPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    await tx
      .insert(meetingTypes)
      .values(
        DEFAULT_MEETING_TYPES.map((t) => ({
          tenantId: p.tenantId,
          code: t.code,
          name: t.name,
          description: null,
          templateConfig: null,
          isStatutory: t.isStatutory,
          frequency: t.frequency,
          createdBy: SYSTEM_ACTOR_ID,
          updatedBy: SYSTEM_ACTOR_ID,
        })),
      )
      .onConflictDoNothing({ target: [meetingTypes.tenantId, meetingTypes.code] });

    await audit(tx, msgMeta(msg), "provision_defaults", "meeting_type_catalogue", p.tenantId);
  });

  await cache.invalidateResource(p.tenantId, "meeting_type");
  log.info({ tenantId: p.tenantId, types: DEFAULT_MEETING_TYPES.length }, "provisioned default meeting types");
}

/**
 * workflow.task.completed → advance minutes / resolution approval state (Req 7.3).
 *
 * The Workflow_Service owns the approval chain; when its task finishes it publishes this
 * fact carrying the entity it approved. We reflect the outcome onto the local record:
 *   - minutes    approved  → status `approved` (records approver + timestamp), emit minutes.approved
 *                rejected  → status `draft`    (returns to the secretary),     emit minutes.rejected
 *   - resolution rejected  → status `withdrawn`, emit resolution.rejected
 *                approved  → already `effective` on record — no state change (audit only)
 * Applying DSC (a separate, explicit `minutes.sign` / `resolution.sign` command) is out of
 * scope here; this handler only reflects the approval decision.
 *
 * Unknown `entityType` / `outcome` are tolerated (logged + ack'd) rather than dead-lettered,
 * because the workflow bus is shared and may carry entities meeting-service does not own.
 */
async function handleWorkflowTaskCompleted(msg: CommandEnvelope<WorkflowTaskCompletedPayload>): Promise<void> {
  const p = msg.payload;
  const entityType = (p.entityType ?? "").trim().toLowerCase();

  if (entityType !== "minutes" && entityType !== "resolution") {
    log.debug({ taskId: p.taskId, entityType }, "workflow.task.completed for a non-meeting entity — skipping");
    return;
  }
  const decision = classifyOutcome(p.outcome ?? "");
  if (decision === "unknown") {
    log.warn({ taskId: p.taskId, entityType, outcome: p.outcome }, "unrecognized workflow outcome — skipping");
    return;
  }

  const approverId = p.actorId ?? SYSTEM_ACTOR_ID;
  const completedAt = p.completedAt ? new Date(p.completedAt) : new Date();

  if (entityType === "minutes") {
    await applyMinutesOutcome(msg, p.entityId, decision, approverId, completedAt);
  } else {
    await applyResolutionOutcome(msg, p.entityId, decision);
  }
}

/** Reflect an approval outcome onto a minutes record (idempotent on redelivery). */
async function applyMinutesOutcome(
  msg: CommandEnvelope<WorkflowTaskCompletedPayload>,
  minutesId: string,
  decision: "approve" | "reject",
  approverId: string,
  completedAt: Date,
): Promise<void> {
  let meetingId: string | null = null;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const rows = await tx
      .select({ version: minutes.version, status: minutes.status, meetingId: minutes.meetingId })
      .from(minutes)
      .where(and(eq(minutes.id, minutesId), eq(minutes.tenantId, msg.tenantId)))
      .limit(1);
    const current = rows[0];
    if (!current) asPermanent(new Error(`minutes ${minutesId} not found for workflow callback`));
    meetingId = current.meetingId;

    if (decision === "approve") {
      // Already finalized (approved/signed/circulated) — idempotent no-op.
      if (["approved", "signed", "circulated"].includes(current.status)) return;
      await versionedUpdate(tx, minutes, {
        id: minutesId,
        tenantId: msg.tenantId,
        expectedVersion: current.version,
        set: { status: "approved", approvedBy: approverId, approvedAt: completedAt, updatedBy: approverId, updatedAt: new Date() },
        entity: "minutes",
      });
      await enqueue(tx, {
        topic: EVENTS.minutesApproved,
        eventType: EVENTS.minutesApproved,
        tenantId: msg.tenantId,
        actorId: approverId,
        correlationId: msg.correlationId,
        payload: { minutesId, meetingId: current.meetingId, approvedBy: approverId, approvedAt: completedAt.toISOString() },
      });
      await audit(tx, msgMeta(msg), "approve", "minutes", minutesId);
    } else {
      // Rejection only meaningful while awaiting approval; otherwise idempotent no-op.
      if (current.status !== "submitted") return;
      const newVersion = current.version + 1;
      await versionedUpdate(tx, minutes, {
        id: minutesId,
        tenantId: msg.tenantId,
        expectedVersion: current.version,
        set: { status: "draft", updatedBy: approverId, updatedAt: new Date() },
        entity: "minutes",
      });
      await enqueue(tx, {
        topic: EVENTS.minutesRejected,
        eventType: EVENTS.minutesRejected,
        tenantId: msg.tenantId,
        actorId: approverId,
        correlationId: msg.correlationId,
        payload: { minutesId, meetingId: current.meetingId, rejectionComments: "returned by approval workflow", newVersion },
      });
      await audit(tx, msgMeta(msg), "reject", "minutes", minutesId);
    }
  });

  await cache.invalidateResource(msg.tenantId, "minutes");
  if (meetingId) await cache.invalidate(cache.makeKey(msg.tenantId, "minutes", meetingId));
}

/** Reflect an approval outcome onto a resolution record (idempotent on redelivery). */
async function applyResolutionOutcome(
  msg: CommandEnvelope<WorkflowTaskCompletedPayload>,
  resolutionId: string,
  decision: "approve" | "reject",
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const rows = await tx
      .select({ version: resolutions.version, status: resolutions.status, meetingId: resolutions.meetingId, number: resolutions.resolutionNumber })
      .from(resolutions)
      .where(and(eq(resolutions.id, resolutionId), eq(resolutions.tenantId, msg.tenantId)))
      .limit(1);
    const current = rows[0];
    if (!current) asPermanent(new Error(`resolution ${resolutionId} not found for workflow callback`));

    if (decision === "reject") {
      if (current.status === "withdrawn") return; // idempotent no-op
      await versionedUpdate(tx, resolutions, {
        id: resolutionId,
        tenantId: msg.tenantId,
        expectedVersion: current.version,
        set: { status: "withdrawn", updatedBy: SYSTEM_ACTOR_ID, updatedAt: new Date() },
        entity: "resolution",
      });
      await enqueue(tx, {
        topic: EVENTS.resolutionRejected,
        eventType: EVENTS.resolutionRejected,
        tenantId: msg.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId: msg.correlationId,
        payload: {
          resolutionId,
          meetingId: current.meetingId,
          resolutionNumber: current.number,
          votesFor: 0,
          votesAgainst: 0,
          votesAbstain: 0,
        },
      });
      await audit(tx, msgMeta(msg), "withdraw", "resolution", resolutionId);
    } else {
      // Approved: a recorded resolution is already `effective`; nothing to change.
      await audit(tx, msgMeta(msg), "approve", "resolution", resolutionId);
    }
  });

  await cache.invalidateResource(msg.tenantId, "resolution");
}

/**
 * workflow.task.assigned → surface the pending approval in the assignee's dashboard.
 * meeting-service keeps no pending-task table of its own; the dashboard read model is
 * cache-backed, so the correct reaction is to invalidate the assignee's pending-tasks
 * cache entry, forcing the next read to reload from source. Cache invalidation is
 * naturally idempotent, so no inbox `markProcessed` write is needed.
 */
async function handleWorkflowTaskAssigned(msg: CommandEnvelope<WorkflowTaskAssignedPayload>): Promise<void> {
  const p = msg.payload;
  await cache.invalidate(cache.makeKey(p.tenantId, "pending_task", p.assigneeId));
  log.debug({ taskId: p.taskId, assigneeId: p.assigneeId }, "invalidated assignee pending-task cache");
}

/**
 * hrms.employee.updated → refresh the participant / committee read caches so a changed
 * designation or reporting line is reflected in the meeting directory views. Pure cache
 * invalidation → naturally idempotent, no `markProcessed` needed.
 */
async function handleHrmsEmployeeUpdated(msg: CommandEnvelope<HrmsEmployeeUpdatedPayload>): Promise<void> {
  const p = msg.payload;
  await cache.invalidateResource(p.tenantId, "participant");
  await cache.invalidateResource(p.tenantId, "committee");
  await cache.invalidate(cache.makeKey(p.tenantId, "employee_directory", p.employeeId));
  log.debug({ employeeId: p.employeeId }, "refreshed participant/committee caches for updated employee");
}

/**
 * hrms.employee.separated → expire the employee's active committee memberships (Req 2.4)
 * and flag their still-open action items for reassignment (Req 9.3).
 *
 * Memberships are expired in bulk (ordered by id for deadlock safety) with a per-member
 * `committee.member_expired` event so downstream (quorum recompute, notifications) reacts.
 * Open action items are NOT silently reassigned to an arbitrary user — the correct owner is
 * a governance decision — so we emit a `compliance.alert` listing the items needing
 * reassignment, which the secretary/chairperson actions. Idempotent via `markProcessed`
 * plus the `status = 'active'` predicate (a second run matches zero rows).
 */
async function handleHrmsEmployeeSeparated(msg: CommandEnvelope<HrmsEmployeeSeparatedPayload>): Promise<void> {
  const p = msg.payload;
  const expiredOn = (p.separationDate ?? new Date().toISOString()).slice(0, 10);

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    // (1) Expire active committee memberships held by the separated employee.
    const memberships = await tx
      .select({ id: committeeMembers.id, committeeId: committeeMembers.committeeId })
      .from(committeeMembers)
      .where(
        and(
          eq(committeeMembers.tenantId, p.tenantId),
          eq(committeeMembers.memberId, p.employeeId),
          eq(committeeMembers.status, "active"),
        ),
      )
      .orderBy(committeeMembers.id);

    for (const m of memberships) {
      await tx
        .update(committeeMembers)
        .set({ status: "expired", tenureEnd: expiredOn, updatedBy: SYSTEM_ACTOR_ID, updatedAt: new Date() })
        .where(and(eq(committeeMembers.id, m.id), eq(committeeMembers.tenantId, p.tenantId)));
      await enqueue(tx, {
        topic: EVENTS.committeeMemberExpired,
        eventType: EVENTS.committeeMemberExpired,
        tenantId: p.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId: msg.correlationId,
        payload: { committeeId: m.committeeId, membershipId: m.id, memberId: p.employeeId, expiredOn },
      });
    }

    // (2) Flag the employee's still-open action items for reassignment (Req 9.3).
    const openItems = await tx
      .select({ id: actionItems.id, meetingId: actionItems.meetingId })
      .from(actionItems)
      .where(
        and(
          eq(actionItems.tenantId, p.tenantId),
          eq(actionItems.assigneeId, p.employeeId),
          inArray(actionItems.status, ["assigned", "acknowledged", "in_progress", "overdue", "escalated"]),
        ),
      )
      .orderBy(actionItems.id);

    if (openItems.length > 0) {
      await enqueue(tx, {
        topic: EVENTS.complianceAlert,
        eventType: EVENTS.complianceAlert,
        tenantId: p.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId: msg.correlationId,
        payload: {
          alertType: "action_reassignment_required",
          detail: {
            reason: "assignee_separated",
            employeeId: p.employeeId,
            actionItemIds: openItems.map((i) => i.id),
          },
        },
      });
    }

    await audit(tx, msgMeta(msg), "handle_separation", "employee", p.employeeId);
  });

  await cache.invalidateResource(p.tenantId, "committee");
  await cache.invalidateResource(p.tenantId, "action_item");
  log.info({ employeeId: p.employeeId }, "processed employee separation");
}

/** Extract the audit/event metadata carried on every envelope. */
function msgMeta(msg: CommandEnvelope<unknown>): MsgMeta {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every cross-service consumed-event handler. worker.ts (task 19.1) calls this with
 * its `registerConsumer`, wiring the CONSUMED_EVENTS topics to the handlers above.
 */
export function registerIntegrationConsumers(register: RegisterConsumer): void {
  register(CONSUMED_EVENTS.tenantCreated, handleTenantCreated);
  register(CONSUMED_EVENTS.workflowTaskCompleted, handleWorkflowTaskCompleted);
  register(CONSUMED_EVENTS.workflowTaskAssigned, handleWorkflowTaskAssigned);
  register(CONSUMED_EVENTS.hrmsEmployeeUpdated, handleHrmsEmployeeUpdated);
  register(CONSUMED_EVENTS.hrmsEmployeeSeparated, handleHrmsEmployeeSeparated);
}
