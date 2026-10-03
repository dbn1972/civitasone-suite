/**
 * Writers for platform-operator management. Every handler runs in ONE transaction
 * under the message's tenant, is idempotent through _inbox.processed, and writes
 * its audit.event.record outbox row in that same transaction. The identity
 * (users / roles / sessions) change happens only on approval, inside the
 * approving transaction; Keycloak is touched only AFTER that commit.
 */
import { pino } from "pino";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { denylistSession } from "@civitasone/auth/denylist";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as keycloak from "../../shared/keycloak.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  REFUSAL_MESSAGE, primaryRoleKey, removesLastSuperAdmin, sameId, validateChange,
  type RefusalCode, type RequestKind,
} from "./domain.js";

const log = pino({ name: "identity-operators-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "platform_operator_request";

type Tx = Parameters<typeof repo.loadOperator>[0];

async function audit(
  tx: unknown, msg: CommandEnvelope, action: string, resourceType: string, resourceId: string,
  outcome: "success" | "denied", extra: Record<string, unknown> = {},
): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "identity", action, resourceType, resourceId, outcome, ...(outcome === "denied" ? { severity: "high" } : {}), ...extra },
  });
}

interface RequestPayload { id: string; targetUserId: string; kind: RequestKind; reason: string; toRole?: string }
interface DecidePayload { requestId: string; decision: "approve" | "reject"; note?: string }

export interface AppliedEffect {
  kind: RequestKind; requestId: string; email: string; fromRole: string; toRole: string | null; revokedSessionIds: string[];
}

export function registerOperatorConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<RequestPayload>(COMMANDS.operatorRequest, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = tx as unknown as Tx;
      const deny = async (code: RefusalCode) => audit(tx, msg, "request_refused", RESOURCE, p.id, "denied", { kind: p.kind, targetUserId: p.targetUserId, code });
      if (sameId(p.targetUserId, msg.actorId)) return deny("SELF_ACTION");
      if (!(await repo.isActivePlatformOperator(t, msg.tenantId, msg.actorId))) return deny("NOT_AN_OPERATOR");
      const target = await repo.loadAccount(t, msg.tenantId, p.targetUserId);
      if (!target) return deny("NOT_AN_OPERATOR");
      const bad = validateChange(p.kind, target, p.toRole);
      if (bad) return deny(bad);
      if (removesLastSuperAdmin(p.kind, target, p.toRole, await repo.countActiveSuperAdmins(t, msg.tenantId))) return deny("LAST_SUPER_ADMIN");
      const fromRole = primaryRoleKey(target.roleKeys) ?? "none";
      const inserted = await repo.insertRequest(t, {
        id: p.id, tenantId: msg.tenantId, kind: p.kind, targetUserId: p.targetUserId, fromRoleKey: fromRole,
        toRoleKey: p.kind === "role_change" || p.kind === "grant" ? (p.toRole ?? null) : null, reason: p.reason.trim(), requestedBy: msg.actorId,
      });
      if (!inserted) return deny("ALREADY_PENDING");
      await audit(tx, msg, "request", RESOURCE, p.id, "success", { kind: p.kind, targetUserId: p.targetUserId, fromRole, ...(p.toRole ? { toRole: p.toRole } : {}), reason: p.reason.trim() });
    });
  });

  queue.subscribe<{ requestId: string }>(COMMANDS.operatorCancel, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = tx as unknown as Tx;
      const req = await repo.lockRequest(t, msg.tenantId, msg.payload.requestId);
      if (!req || req.status !== "pending" || !sameId(req.requestedBy, msg.actorId)) return;
      if (!(await repo.decideRequest(t, msg.tenantId, req.id, "cancelled", msg.actorId, null))) return;
      await audit(tx, msg, "cancel", RESOURCE, req.id, "success", { kind: req.kind, targetUserId: req.targetUserId });
    });
  });

  queue.subscribe<DecidePayload>(COMMANDS.operatorDecide, async (msg) => {
    const effect = await db.transaction((tx) => applyDecision(tx as unknown as Tx, tx, msg));
    if (effect) await afterCommit(msg, effect);
  });
}

/**
 * The approving / rejecting transaction. Lock order is fixed (request, super_admin
 * role row, target user) so concurrent decisions serialise instead of deadlocking.
 * Exported for the race tests.
 */
export async function applyDecision(t: Tx, rawTx: unknown, msg: CommandEnvelope & { payload: DecidePayload }): Promise<AppliedEffect | null> {
  const p = msg.payload;
  if (!(await markProcessed(rawTx as Parameters<typeof markProcessed>[0], msg.messageId))) return null;
  const req = await repo.lockRequest(t, msg.tenantId, p.requestId);
  if (!req || req.status !== "pending") {
    log.info({ requestId: p.requestId }, "operator decision skipped: request is no longer pending");
    return null;
  }
  const denied = async (code: RefusalCode) => {
    await audit(rawTx, msg, `${p.decision}_refused`, RESOURCE, req.id, "denied", { kind: req.kind, targetUserId: req.targetUserId, code });
    return null;
  };
  // Maker != checker, then the checker must be an ACTIVE super_admin right now (not just per the token).
  if (sameId(req.requestedBy, msg.actorId)) return denied("SELF_ACTION");
  await repo.lockSuperAdminRole(t, msg.tenantId);
  if (!(await repo.isActiveSuperAdmin(t, msg.tenantId, msg.actorId))) return denied("NOT_AN_OPERATOR");
  const note = p.note?.trim() || null;

  if (p.decision === "reject") {
    if (!(await repo.decideRequest(t, msg.tenantId, req.id, "rejected", msg.actorId, note))) return null;
    await audit(rawTx, msg, "reject", RESOURCE, req.id, "success", { kind: req.kind, targetUserId: req.targetUserId, ...(note ? { note } : {}) });
    return null;
  }

  // Approve. Everything the request assumed is re-derived under the locks.
  const kind = req.kind as RequestKind;
  const target = await repo.loadAccount(t, msg.tenantId, req.targetUserId, true);
  const refuse = async (code: RefusalCode) => {
    await repo.decideRequest(t, msg.tenantId, req.id, "refused", msg.actorId, note, { refusalReason: REFUSAL_MESSAGE[code].slice(0, 200) });
    await audit(rawTx, msg, "approve_refused", RESOURCE, req.id, "denied", { kind, targetUserId: req.targetUserId, code });
    return null;
  };
  if (!target) return refuse("NOT_AN_OPERATOR");
  if ((primaryRoleKey(target.roleKeys) ?? "none") !== req.fromRoleKey) return refuse("INVALID_STATE");
  const bad = validateChange(kind, target, req.toRoleKey);
  if (bad) return refuse(bad);
  if (removesLastSuperAdmin(kind, target, req.toRoleKey, await repo.countActiveSuperAdmins(t, msg.tenantId))) return refuse("LAST_SUPER_ADMIN");

  let revokedSessionIds: string[] = [];
  if (kind === "suspend") {
    await repo.setUserStatus(t, msg.tenantId, target.id, "suspended", msg.actorId);
    revokedSessionIds = await repo.revokeUserSessions(t, msg.tenantId, target.id, msg.actorId);
  } else if (kind === "reactivate") {
    await repo.setUserStatus(t, msg.tenantId, target.id, "active", msg.actorId);
  } else {
    // role_change and grant: both end with the user holding exactly the requested platform role.
    const toRoleId = req.toRoleKey ? await repo.roleIdByKey(t, msg.tenantId, req.toRoleKey) : null;
    if (!toRoleId) return refuse("INVALID_ROLE");
    await repo.changePlatformRole(t, msg.tenantId, target.id, toRoleId, msg.actorId, req.reason);
    revokedSessionIds = await repo.revokeUserSessions(t, msg.tenantId, target.id, msg.actorId);
  }
  if (!(await repo.decideRequest(t, msg.tenantId, req.id, "approved", msg.actorId, note, { applied: true, kcSync: keycloak.isKeycloakEnabled() ? "pending" : "skipped" }))) {
    throw new Error("operator request changed while approving"); // cannot happen under the row lock; abort the whole transaction if it does
  }
  await audit(rawTx, msg, "approve", RESOURCE, req.id, "success", { kind, targetUserId: target.id, fromRole: req.fromRoleKey, ...(req.toRoleKey ? { toRole: req.toRoleKey } : {}), requestedBy: req.requestedBy });
  await audit(rawTx, msg, kind, "platform_operator", target.id, "success", {
    requestId: req.id, requestedBy: req.requestedBy, reason: req.reason, fromRole: req.fromRoleKey, ...(req.toRoleKey ? { toRole: req.toRoleKey } : {}), sessionsRevoked: revokedSessionIds.length,
  });
  return { kind, requestId: req.id, email: target.email, fromRole: req.fromRoleKey, toRole: req.toRoleKey, revokedSessionIds };
}

/** After the commit: deny-list the revoked sessions and sync Keycloak. Best effort; the outcome is recorded on the request. */
async function afterCommit(msg: CommandEnvelope, e: AppliedEffect): Promise<void> {
  for (const sid of e.revokedSessionIds) await denylistSession(sid).catch((err) => log.warn({ sid, err: String(err) }, "session denylist failed"));
  if (!keycloak.isKeycloakEnabled()) return;
  let ok = false;
  try {
    const r = e.kind === "suspend" ? await keycloak.deactivateUser(msg.tenantId, e.email, log)
      : e.kind === "reactivate" ? await keycloak.enableUser(msg.tenantId, e.email, log)
        : await keycloak.replaceRealmRoles({ tenantId: msg.tenantId, email: e.email }, e.fromRole === "none" ? [] : [e.fromRole], e.toRole ? [e.toRole] : [], log);
    ok = r.ok;
    if (!r.ok) log.warn({ requestId: e.requestId, reason: r.reason }, "operator change applied but keycloak sync failed");
  } catch (err) {
    log.error({ requestId: e.requestId, err: String(err) }, "operator change applied but keycloak sync threw");
  }
  await db.transaction(async (tx) => { await repo.setKcSync(tx as unknown as Tx, msg.tenantId, e.requestId, ok ? "ok" : "failed"); })
    .catch((err) => log.error({ requestId: e.requestId, err: String(err) }, "could not record keycloak sync outcome"));
}
