/**
 * GAP-ADMIN-TENANTS-DETAIL-05 -- consumers for tenant lifecycle approval.
 *
 * Register with tenantScoped(queue): every write here lands in RLS-forced
 * tables and the message's tenantId is the TARGET tenant.
 *
 * Each handler is ONE transaction: the state change, its audit event and any
 * domain event commit together through the outbox. A failed action (e.g. an
 * invalid transition discovered at execution time) rolls the whole thing back
 * and is then recorded in a second, small transaction -- no nested
 * transactions.
 */
import { pino } from "pino";
import { ZodError } from "zod";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent, domainEvent, type OutboxCtx } from "../../shared/audit.js";
import { COMMANDS, EVENTS, RESOURCE_TENANT } from "../../topics.js";
import * as repo from "./repo.js";
import * as lrepo from "./lifecycle-repo.js";
import { assertTransition } from "./domain.js";
import type { LifecycleRequestRow } from "./schema.js";
import {
  approvalPolicySchema, assertCanCancel, assertCanDecide, assertNotOwnTenant, assertReason, diffFields, editPayloadSchema,
  holdsAnyRole, KIND_TARGET_STATUS, LifecycleError, requirementsFor, resolvePolicy,
  type LifecycleKind,
} from "./lifecycle-domain.js";
import { publishExecuteDue, type LifecycleCancelPayload, type LifecycleDecisionPayload, type LifecycleRequestPayload } from "./lifecycle-commands.js";

const log = pino({ name: "admin-tenant-lifecycle-consumer" });

type Tx = Parameters<typeof lrepo.insertRequest>[0];
type Msg<T> = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: T };

/** Thrown only by executeAction(): the transaction is rolled back and the request recorded as failed. */
class ExecutionFailure extends Error {
  constructor(public code: string, public requestId: string, cause?: unknown) {
    super(`lifecycle execution failed: ${code}`, cause === undefined ? undefined : { cause });
  }
}

const keyFor = (id: string) => cache.makeKey(id, RESOURCE_TENANT, id);
const ctxOf = (m: { tenantId: string; actorId: string; correlationId: string }): OutboxCtx =>
  ({ tenantId: m.tenantId, actorId: m.actorId, correlationId: m.correlationId });

/**
 * Runs the approved action against the tenant row. Always called inside the
 * decision's transaction, with the tenant row freshly read there.
 */
async function executeAction(tx: Tx, ctx: OutboxCtx, req: LifecycleRequestRow, extra: Record<string, unknown>): Promise<void> {
  const tenantId = req.tenantId;
  const kind = req.kind as LifecycleKind;
  try {
    const cur = await repo.findByIdTx(tx, tenantId);
    if (!cur) throw new LifecycleError("NOT_FOUND", "tenant not found", 404);
    const policy = resolvePolicy(cur.settings);
    let oldValue: Record<string, unknown> = {};
    let newValue: Record<string, unknown> = {};

    if (kind === "suspend" || kind === "reactivate") {
      const to = KIND_TARGET_STATUS[kind]!;
      assertTransition(cur.status, to);
      await repo.update(tx, tenantId, { status: to, updatedBy: ctx.actorId, version: cur.version + 1 });
      oldValue = { status: cur.status };
      newValue = { status: to };
      await domainEvent(tx, ctx, kind === "suspend" ? EVENTS.tenantSuspended : EVENTS.tenantReactivated,
        { tenantId, reason: req.reason, requestId: req.id });
    } else if (kind === "edit") {
      const patch = editPayloadSchema.parse(req.payload);
      const d = diffFields(cur as unknown as Record<string, unknown>, patch);
      if (Object.keys(d.after).length === 0) throw new LifecycleError("NO_CHANGE", "nothing to change", 409);
      await repo.update(tx, tenantId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
        ...(patch.edition !== undefined ? { edition: patch.edition } : {}),
        updatedBy: ctx.actorId, version: cur.version + 1,
      });
      oldValue = d.before;
      newValue = d.after;
    } else {
      const next = approvalPolicySchema.parse((req.payload as { policy?: unknown }).policy);
      await lrepo.writePolicy(tx, tenantId, next, ctx.actorId);
      oldValue = { approvalPolicy: policy };
      newValue = { approvalPolicy: next };
    }

    await lrepo.markExecuted(tx, tenantId, req.id);
    // Who authorised this, explicitly: every approver, or the requester alone
    // when the policy allowed direct execution.
    const voters = await lrepo.listApproverIdsTx(tx, tenantId, req.id);
    const approvers = voters.length > 0 ? voters : [req.requestedBy];
    await auditEvent(tx, ctx, kind, "tenant", tenantId, {
      requestId: req.id, requestedBy: req.requestedBy, reason: req.reason, oldValue, newValue, approvers, ...extra,
    });
    if (policy.notifyTenantAdmins && kind !== "policy_change") {
      await domainEvent(tx, ctx, EVENTS.tenantLifecycleNotify, { tenantId, action: kind, requestId: req.id });
    }
  } catch (err) {
    // Only PERMANENT failures become a recorded `failed` request: a rule refusal,
    // an invalid stored payload, or a database constraint violation (SQLSTATE
    // class 23, e.g. a duplicate domain). Anything else -- a serialization
    // failure, a dropped connection, a deadlock -- is transient: rethrow so the
    // transaction rolls back un-marked and the queue redelivers.
    if (err instanceof LifecycleError) throw new ExecutionFailure(err.code, req.id, err);
    if (err instanceof Error && err.name === "DomainError") throw new ExecutionFailure((err as Error & { code: string }).code, req.id, err);
    if (err instanceof ZodError || hasSqlState(err, "23")) throw new ExecutionFailure("EXECUTION_FAILED", req.id, err);
    throw err;
  }
}

// ── request ───────────────────────────────────────────────────────────────────

export async function handleRequest(msg: Msg<LifecycleRequestPayload>): Promise<void> {
  const p = msg.payload;
  const ctx = ctxOf(msg);
  try {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = tx as unknown as Tx;
      const cur = await repo.findByIdTx(t, msg.tenantId);
      if (!cur) { log.warn({ tenantId: msg.tenantId }, "lifecycle request for unknown tenant"); return; }
      const policy = resolvePolicy(cur.settings);
      const need = requirementsFor(p.kind, policy);

      const denied = (() => {
        try {
          assertNotOwnTenant({ tenantId: p.actorTenantId, roles: p.actorRoles }, msg.tenantId);
          const reason = assertReason(p.reason, need.reasonRequired);
          if (!holdsAnyRole(p.actorRoles, need.approverRoles) && need.direct) {
            throw new LifecycleError("NOT_AN_APPROVER", "your role may not act directly under this tenant's policy", 403);
          }
          if (p.kind === "suspend" || p.kind === "reactivate") assertTransition(cur.status, KIND_TARGET_STATUS[p.kind]!);
          if (p.kind === "reactivate" && cur.status !== "suspended") {
            throw new LifecycleError("INVALID_TRANSITION", "only a suspended tenant can be reactivated", 409);
          }
          if (p.kind === "edit") editPayloadSchema.parse(p.edit);
          if (p.kind === "policy_change") approvalPolicySchema.parse(p.policy);
          return { reason, error: null as LifecycleError | null };
        } catch (e) {
          if (e instanceof LifecycleError) return { reason: p.reason ?? "", error: e };
          return { reason: p.reason ?? "", error: new LifecycleError("INVALID_REQUEST", "request is not valid for this tenant", 400) };
        }
      })();

      const base = {
        id: p.requestId, tenantId: msg.tenantId, kind: p.kind, reason: denied.reason,
        payload: p.kind === "edit" ? (p.edit ?? {}) : p.kind === "policy_change" ? { policy: p.policy } : {},
        effectiveAt: p.kind === "suspend" && p.effectiveAt ? new Date(p.effectiveAt) : null,
        requestedBy: msg.actorId, requiredApprovals: need.requiredApprovals, approverRoles: need.approverRoles,
      } as const;

      if (denied.error) {
        // The attempt is recorded, never silently dropped.
        await lrepo.insertRequest(t, { ...base, status: "failed", failureCode: denied.error.code, decidedBy: msg.actorId, decidedAt: new Date() });
        await auditEvent(tx, ctx, `${p.kind}_denied`, "tenant", msg.tenantId, { requestId: p.requestId, code: denied.error.code });
        return;
      }

      if (need.direct) {
        // Policy says no second approver: the requester's own action executes
        // at once, still as a recorded + audited request.
        const due = base.effectiveAt === null || base.effectiveAt.getTime() <= Date.now();
        await lrepo.insertRequest(t, { ...base, status: due ? "executed" : "scheduled", directExecution: true, decidedBy: msg.actorId, decidedAt: new Date() });
        if (due) {
          const row = await lrepo.findRequestTx(t, msg.tenantId, p.requestId);
          await executeAction(t, ctx, row!, { directExecution: true, approvedBy: msg.actorId });
        } else {
          await auditEvent(tx, ctx, `${p.kind}_scheduled`, "tenant", msg.tenantId, { requestId: p.requestId, directExecution: true, effectiveAt: p.effectiveAt });
        }
        return;
      }

      await lrepo.insertRequest(t, { ...base, status: "pending" });
      await auditEvent(tx, ctx, `${p.kind}_requested`, "tenant", msg.tenantId, {
        requestId: p.requestId, reason: denied.reason, requiredApprovals: need.requiredApprovals,
        ...(p.kind === "policy_change" ? { oldValue: { approvalPolicy: policy }, newValue: { approvalPolicy: p.policy } } : {}),
      });
    });
    await cache.invalidate(keyFor(msg.tenantId));
  } catch (err) {
    if (err instanceof ExecutionFailure) {
      await recordFailedRequest(msg, p, err);
      return;
    }
    if (isUniqueViolation(err)) {
      // Another request of this kind is already open: the unique index refused the duplicate.
      log.warn({ tenantId: msg.tenantId, kind: p.kind }, "duplicate open lifecycle request ignored");
      return;
    }
    log.error({ err, messageId: msg.messageId }, "lifecycle request failed");
    throw err;
  }
}

async function recordFailedRequest(msg: Msg<LifecycleRequestPayload>, p: LifecycleRequestPayload, err: ExecutionFailure): Promise<void> {
  const ctx = ctxOf(msg);
  await db.transaction(async (tx) => {
    const t = tx as unknown as Tx;
    await lrepo.insertRequest(t, {
      id: p.requestId, tenantId: msg.tenantId, kind: p.kind, reason: p.reason ?? "", payload: {},
      requestedBy: msg.actorId, status: "failed", failureCode: err.code, decidedBy: msg.actorId, decidedAt: new Date(),
      requiredApprovals: 0, approverRoles: [], directExecution: true,
    });
    await auditEvent(tx, ctx, `${p.kind}_failed`, "tenant", msg.tenantId, { requestId: p.requestId, code: err.code });
  });
}

// ── decision ──────────────────────────────────────────────────────────────────

export async function handleDecision(msg: Msg<LifecycleDecisionPayload>): Promise<void> {
  const p = msg.payload;
  const ctx = ctxOf(msg);
  try {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = tx as unknown as Tx;
      const req = await lrepo.findRequestTx(t, msg.tenantId, p.requestId);
      if (!req) { log.warn({ requestId: p.requestId }, "decision for unknown lifecycle request"); return; }

      try {
        assertCanDecide({
          actor: { actorId: msg.actorId, tenantId: p.actorTenantId, roles: p.actorRoles },
          request: { requestedBy: req.requestedBy, tenantId: req.tenantId, approverRoles: req.approverRoles, status: req.status },
        });
      } catch (e) {
        if (!(e instanceof LifecycleError)) throw e;
        await auditEvent(tx, ctx, `${req.kind}_decision_denied`, "tenant", msg.tenantId, { requestId: req.id, code: e.code, attempted: p.decision });
        return;
      }

      if (p.decision === "reject") {
        const row = await lrepo.rejectConditional(t, msg.tenantId, req.id, msg.actorId, p.comment);
        if (!row) return; // lost the race: someone else already decided
        await auditEvent(tx, ctx, `${req.kind}_rejected`, "tenant", msg.tenantId, { requestId: req.id, requestedBy: req.requestedBy, comment: p.comment });
        return;
      }

      const voteId = await lrepo.insertApproval(t, {
        tenantId: msg.tenantId, requestId: req.id, approverId: msg.actorId, approverRoles: p.actorRoles, comment: p.comment,
      });
      if (!voteId) return; // this approver already voted
      const row = await lrepo.approveConditional(t, msg.tenantId, req.id, msg.actorId, p.comment);
      if (!row) {
        // Lost the race to a concurrent decision: withdraw the vote, do nothing else.
        await lrepo.deleteApproval(t, msg.tenantId, voteId);
        return;
      }
      if (row.status === "pending") {
        await auditEvent(tx, ctx, `${req.kind}_approval_recorded`, "tenant", msg.tenantId, {
          requestId: req.id, approvals: row.approvalsCount, required: row.requiredApprovals,
        });
      } else if (row.status === "scheduled") {
        await auditEvent(tx, ctx, `${req.kind}_approved_scheduled`, "tenant", msg.tenantId, { requestId: req.id, effectiveAt: row.effectiveAt?.toISOString() });
      } else {
        await executeAction(t, ctx, row, { approvedBy: msg.actorId, approvals: row.approvalsCount });
      }
    });
    await cache.invalidate(keyFor(msg.tenantId));
  } catch (err) {
    if (err instanceof ExecutionFailure) {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Tx;
        if (await lrepo.markFailed(t, msg.tenantId, err.requestId, err.code, msg.actorId)) {
          await auditEvent(tx, ctx, "lifecycle_execution_failed", "tenant", msg.tenantId, { requestId: err.requestId, code: err.code });
        }
      });
      return;
    }
    log.error({ err, messageId: msg.messageId }, "lifecycle decision failed");
    throw err;
  }
}

// ── scheduled execution ───────────────────────────────────────────────────────

export async function handleExecuteDue(msg: Msg<{ requestId: string }>): Promise<void> {
  const ctx = ctxOf(msg);
  try {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = tx as unknown as Tx;
      const row = await lrepo.claimDueScheduled(t, msg.tenantId, msg.payload.requestId);
      if (!row) return;
      await executeAction(t, ctx, row, { approvedBy: row.decidedBy, scheduled: true, effectiveAt: row.effectiveAt?.toISOString() ?? null });
    });
    await cache.invalidate(keyFor(msg.tenantId));
  } catch (err) {
    if (err instanceof ExecutionFailure) {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Tx;
        if (await lrepo.markFailed(t, msg.tenantId, err.requestId, err.code, msg.actorId)) {
          await auditEvent(tx, ctx, "lifecycle_execution_failed", "tenant", msg.tenantId, { requestId: err.requestId, code: err.code });
        }
      });
      return;
    }
    log.error({ err, messageId: msg.messageId }, "scheduled lifecycle execution failed");
    throw err;
  }
}

/** True when the error (or a wrapped cause) carries a SQLSTATE starting with `prefix`. */
function hasSqlState(err: unknown, prefix: string): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const code = typeof e === "object" ? (e as { code?: unknown }).code : undefined;
    if (typeof code === "string" && code.startsWith(prefix)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e === "object" && (e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// ── cancel a scheduled request ────────────────────────────────────────────────

export async function handleCancel(msg: Msg<LifecycleCancelPayload>): Promise<void> {
  const p = msg.payload;
  const ctx = ctxOf(msg);
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const t = tx as unknown as Tx;
    const req = await lrepo.findRequestTx(t, msg.tenantId, p.requestId);
    if (!req) { log.warn({ requestId: p.requestId }, "cancel for unknown lifecycle request"); return; }
    const approverIds = await lrepo.listApproverIdsTx(t, msg.tenantId, req.id);
    try {
      assertCanCancel({
        actor: { actorId: msg.actorId, tenantId: p.actorTenantId, roles: p.actorRoles },
        request: { requestedBy: req.requestedBy, tenantId: req.tenantId, status: req.status },
        approverIds,
      });
    } catch (e) {
      if (!(e instanceof LifecycleError)) throw e;
      await auditEvent(tx, ctx, `${req.kind}_cancel_denied`, "tenant", msg.tenantId, { requestId: req.id, code: e.code });
      return;
    }
    const row = await lrepo.cancelScheduled(t, msg.tenantId, req.id, msg.actorId, p.reason);
    if (!row) return; // the due-sweep got there first
    await auditEvent(tx, ctx, `${req.kind}_cancelled`, "tenant", msg.tenantId, {
      requestId: req.id, requestedBy: req.requestedBy, approvers: approverIds.length > 0 ? approverIds : [req.requestedBy],
      reason: p.reason, effectiveAt: req.effectiveAt?.toISOString() ?? null,
    });
  });
  await cache.invalidate(keyFor(msg.tenantId));
}

export function registerTenantLifecycleConsumers(queue: Queue): void {
  queue.subscribe<LifecycleRequestPayload>(COMMANDS.tenantLifecycleRequest, handleRequest as never);
  queue.subscribe<LifecycleDecisionPayload>(COMMANDS.tenantLifecycleDecide, handleDecision as never);
  queue.subscribe<LifecycleCancelPayload>(COMMANDS.tenantLifecycleCancel, handleCancel as never);
  queue.subscribe<{ requestId: string }>(COMMANDS.tenantLifecycleExecuteDue, handleExecuteDue as never);
}


/**
 * Finds suspensions whose approved effective time has arrived and publishes one
 * execute_due command per request (the consumer does the write). Reads are
 * platform-wide by design -- this is a trusted internal job with no user input.
 */
export async function sweepDueLifecycle(limit = 100): Promise<number> {
  const due = await lrepo.listDue(limit);
  for (const r of due) {
    await publishExecuteDue({ id: r.id, tenantId: r.tenantId, actorId: r.decidedBy ?? r.requestedBy });
  }
  return due.length;
}

export function startLifecycleSweeper(intervalMs: number): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    sweepDueLifecycle()
      .catch((err) => log.error({ err }, "tenant lifecycle due-sweep failed"))
      .finally(() => { running = false; });
  }, intervalMs);
}
