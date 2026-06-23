import type { FastifyInstance } from "fastify";
import {
  syncPushRequestSchema,
  syncPushResponseSchema,
  syncPullRequestSchema,
  syncPullResponseSchema,
} from "@civitasone/schemas/identity";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, HttpError } from "../../shared/context.js";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import * as repo from "../devices/repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * SEC-3: per-mailbox ABAC. A mailbox may only be synced by an actor holding one
 * of the allowed roles. super_admin is allowed everywhere. Sensitive mailboxes
 * (payments/finance/payroll) require their domain admin role; a viewer cannot
 * pull them. Unknown mailboxes require at least an authenticated non-viewer.
 */
const MAILBOX_ROLES: Record<string, string[]> = {
  payments: ["finance_admin", "payroll_admin"],
  finance: ["finance_admin"],
  payroll: ["payroll_admin"],
  ledger: ["finance_admin"],
  hr: ["hr_admin"],
  employees: ["hr_admin"],
};

const BASELINE_ROLES = [
  "officer",
  "hr_admin",
  "payroll_admin",
  "finance_admin",
  "auditor",
  "super_admin",
];

// 03-T7: mailboxes that are personal to a user. Pull from these is scoped to the
// actor's own (or unowned) rows so same-tenant users cannot read each other's.
const USER_PRIVATE_MAILBOXES = new Set<string>(["notifications"]);

/**
 * 03-T1: write-through mailboxes. Push is normally write-only changelog
 * telemetry — it never touches domain tables, so a pushed create/update is NOT
 * visible via the normal domain read API. For the mailboxes below, an *applied*
 * mutation is ALSO enqueued (transactional outbox) as the matching domain
 * command, so the write flows through the normal CQRS command path and becomes
 * visible via the domain read API.
 *
 * Mapping is per (mailbox, operation): a mailbox may be write-through for some
 * operations (e.g. create) while having no clean command for others. An
 * operation with no mapped command is changelog-only for that mailbox, and any
 * mailbox absent from this table is changelog-only entirely (we do NOT fake a
 * command where no clean mapping exists).
 *
 * Write-through mailboxes (mutation operation → domain command topic):
 *   employees        create → hrms.employee.create
 *   leave_requests   create → hrms.leave.apply
 *   crm_contacts     create → crm.contact.create
 *                    update → crm.contact.update
 *                    delete → crm.contact.delete
 *   crm_deals        create → crm.deal.create
 *   helpdesk_tickets create → helpdesk.ticket.create
 *   projects         create → project.project.create
 *
 * Changelog-only (telemetry; no clean single client→authoritative command):
 *   attendance     — keyed by employeeId:date, not the uuid entityId a push carries
 *   payments       — projection of finance/payroll/grant settlement events
 *   journals       — server-authored double-entry GL postings
 *   indents        — fed from approval/terminal events, not client creates
 *   purchase_orders— fed from po.approved (terminal), not client creates
 *   approvals      — server-driven workflow instance state
 *   estab_files    — fed from file.created + file.moved (no single command)
 *   mis_metrics    — read-only analytics query results
 *   applications   — fed from approval/rejection/SLA events, not client creates
 *   grievances     — fed from resolved/escalated terminal events
 *   notifications  — delivery telemetry
 */
const WRITE_THROUGH_COMMANDS: Record<
  string,
  Partial<Record<"create" | "update" | "delete", string>>
> = {
  employees: { create: "hrms.employee.create" },
  leave_requests: { create: "hrms.leave.apply" },
  crm_contacts: {
    create: "crm.contact.create",
    update: "crm.contact.update",
    delete: "crm.contact.delete",
  },
  crm_deals: { create: "crm.deal.create" },
  helpdesk_tickets: { create: "helpdesk.ticket.create" },
  projects: { create: "project.project.create" },
};

/** Resolve the domain command topic for an applied mutation, if write-through. */
function resolveWriteThroughCommand(
  mailbox: string,
  operation: "create" | "update" | "delete",
): string | null {
  return WRITE_THROUGH_COMMANDS[mailbox]?.[operation] ?? null;
}

function authorizeMailbox(ctx: RequestContext, mailbox: string): void {
  if (ctx.roles.includes("super_admin")) return;
  const required = MAILBOX_ROLES[mailbox];
  if (required) {
    if (!hasAnyRole(ctx, required)) {
      throw new HttpError(403, "FORBIDDEN", `mailbox '${mailbox}' requires one of: ${required.join(", ")}`);
    }
    return;
  }
  // Unknown mailbox: require an authenticated, non-viewer baseline role.
  if (!hasAnyRole(ctx, BASELINE_ROLES)) {
    throw new HttpError(403, "FORBIDDEN", `not authorized to sync mailbox '${mailbox}'`);
  }
}

/**
 * SEC-3: every push/pull must come from a registered, non-revoked device owned
 * by the actor in the actor's tenant.
 */
async function assertTrustedDevice(ctx: RequestContext, deviceId: string): Promise<void> {
  if (!deviceId) {
    throw new HttpError(400, "BAD_REQUEST", "deviceId is required");
  }
  const device = await repo.findDevice(ctx.tenantId, deviceId, ctx.actorId);
  if (!device) {
    throw new HttpError(403, "DEVICE_NOT_TRUSTED", "device is not registered for this user");
  }
  if (device.trustLevel === "revoked" || device.trustLevel === "blocked") {
    throw new HttpError(403, "DEVICE_REVOKED", "device has been revoked");
  }
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/sync/push", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = syncPushRequestSchema.parse(req.body);
    authorizeMailbox(ctx, body.mailbox);
    await assertTrustedDevice(ctx, body.deviceId);

    type Result = {
      clientMutationId: string;
      status: "applied" | "conflict" | "failed";
      etag?: string;
      serverData?: Record<string, unknown>;
      reason?: string;
    };
    const results: Result[] = [];
    let latestCursor = body.cursor;

    await db.transaction(async (tx) => {
      for (const m of body.mutations) {
        try {
          // Each mutation runs in its own SAVEPOINT so a failure rolls back only
          // that mutation, leaving the rest of the batch committable (SYN-1d).
          const result = await tx.transaction(async (sp): Promise<Result> => {
            // SYN-1b: replay detection — return the prior outcome unchanged.
            const prior = await repo.findProcessedMutation(sp as repo.Writer, ctx.tenantId, body.deviceId, m.clientMutationId);
            if (prior) {
              if (prior.status === "applied" && prior.resultSeq) latestCursor = prior.resultSeq;
              return {
                clientMutationId: m.clientMutationId,
                status: prior.status,
                ...(prior.resultEtag ? { etag: prior.resultEtag } : {}),
                ...(prior.reason ? { reason: prior.reason } : {}),
              };
            }

            // SYN-1c: conflict detection via base etag vs. latest committed state.
            const latest = await repo.getLatestEntityState(sp as repo.Writer, ctx.tenantId, body.mailbox, m.entityId);
            if (m.baseEtag && latest && latest.etag !== m.baseEtag) {
              await repo.recordProcessedMutation(sp as repo.Writer, {
                tenantId: ctx.tenantId, deviceId: body.deviceId, clientMutationId: m.clientMutationId,
                mailbox: body.mailbox, entityId: m.entityId, status: "conflict", reason: "stale_base_version",
              });
              return {
                clientMutationId: m.clientMutationId,
                status: "conflict",
                etag: latest.etag,
                ...(latest.payload ? { serverData: latest.payload } : {}),
                reason: "stale_base_version",
              };
            }

            // Apply this single mutation and record its outcome.
            const result = await repo.appendChangelogOne(sp as repo.Writer, {
              tenantId: ctx.tenantId,
              mailbox: body.mailbox,
              entityId: m.entityId,
              operation: m.operation,
              payload: m.payload,
            });
            await repo.recordProcessedMutation(sp as repo.Writer, {
              tenantId: ctx.tenantId, deviceId: body.deviceId, clientMutationId: m.clientMutationId,
              mailbox: body.mailbox, entityId: m.entityId, status: "applied",
              resultEtag: result.etag, resultSeq: result.seq,
            });

            // 03-T1: write-through. For mapped mailboxes, also enqueue the
            // matching domain command on the transactional outbox (same
            // SAVEPOINT as the changelog + processed_mutations row, so it is
            // atomic and idempotent) so the write flows through the normal CQRS
            // path and becomes visible via the domain read API. Unmapped
            // mailboxes/operations stay changelog-only telemetry.
            const commandTopic = resolveWriteThroughCommand(body.mailbox, m.operation);
            if (commandTopic) {
              await enqueue(sp as Parameters<typeof enqueue>[0], {
                topic: commandTopic,
                eventType: commandTopic,
                tenantId: ctx.tenantId,
                actorId: ctx.actorId,
                correlationId: ctx.correlationId,
                // Authoritative id/tenant override any client-supplied values.
                payload: { ...m.payload, id: m.entityId, tenantId: ctx.tenantId },
              });
            }

            latestCursor = result.seq;
            return { clientMutationId: m.clientMutationId, status: "applied", etag: result.etag };
          });
          results.push(result);
        } catch (err) {
          req.log.error({ err, clientMutationId: m.clientMutationId, mailbox: body.mailbox }, "sync push mutation failed");
          results.push({ clientMutationId: m.clientMutationId, status: "failed", reason: "server_error" });
        }
      }

      // SEC-3: every push produces an audit row (transactional outbox).
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "identity",
          action: "sync_push",
          resourceType: "sync_mailbox",
          resourceId: body.mailbox,
          outcome: "success",
          deviceId: body.deviceId,
          mailbox: body.mailbox,
          entityIds: body.mutations.map((m) => m.entityId),
          mutationCount: body.mutations.length,
          appliedCount: results.filter((r) => r.status === "applied").length,
          conflictCount: results.filter((r) => r.status === "conflict").length,
        },
      });
    });

    await repo.setCursor(ctx.tenantId, ctx.actorId, body.deviceId, body.mailbox, latestCursor);

    // Backward-compatible aggregates derived from per-mutation results.
    const applied = results.filter((r) => r.status === "applied").map((r) => r.clientMutationId);
    const conflicts = results
      .filter((r) => r.status === "conflict" || r.status === "failed")
      .map((r) => ({ clientMutationId: r.clientMutationId, reason: r.reason ?? r.status }));

    sendValidated(reply, syncPushResponseSchema, {
      mailbox: body.mailbox,
      cursor: latestCursor,
      applied,
      conflicts,
      results,
    });
  });

  app.post("/v1/sync/pull", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = syncPullRequestSchema.parse(req.body);
    authorizeMailbox(ctx, body.mailbox);
    await assertTrustedDevice(ctx, body.deviceId);

    const since = BigInt(body.cursor || "0");
    const rows = await repo.pullSince(ctx.tenantId, body.mailbox, since, body.limit, {
      userId: ctx.actorId,
      userPrivate: USER_PRIVATE_MAILBOXES.has(body.mailbox),
    });
    const entities = rows.map((r) => ({
      id: r.entityId,
      operation: r.operation === "delete" ? "delete" as const : "upsert" as const,
      data: r.payload ?? undefined,
      updatedAt: new Date(r.createdAt as unknown as string).toISOString(),
      etag: r.etag,
    }));
    const nextCursor = rows.length > 0 ? String(rows[rows.length - 1]!.seq) : body.cursor;
    if (rows.length > 0) {
      await repo.setCursor(ctx.tenantId, ctx.actorId, body.deviceId, body.mailbox, nextCursor);
    }
    sendValidated(reply, syncPullResponseSchema, {
      mailbox: body.mailbox,
      cursor: nextCursor,
      hasMore: rows.length >= body.limit,
      entities,
    });
  });
}
