/** Auto-generated F3 apply (central-config). */

/**
 * CAP-091 Central Config Management — HTTP routes.
 *
 * A governed, versioned, maker-checker, encrypted-where-sensitive, audited
 * config store. Follows the change/release module pattern: writes run
 * synchronously inside a single db.transaction and emit an audit event through
 * the transactional outbox in the SAME transaction.
 *
 *   propose  → config_change_requests(status=pending)
 *   approve  → (approver != proposer) apply value to config_entries (version++)
 *              + append immutable config_versions row + audit
 *   reject   → config_change_requests(status=rejected)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import {
  ConfigError,
  assertApproverDistinct,
  assertPending,
  nextVersion,
  sealForStorage,
  displayValue,
  configKey,
} from "./domain.js";
import type { ConfigEntryRow, ConfigChangeRow, ConfigVersionRow } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const CONFIG_ROLES = [...TENANT_ADMIN_ROLES];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const proposeBody = z.object({
  key: z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/, "invalid config key"),
  value: z.unknown().refine((v) => v !== undefined, "value is required"),
  sensitive: z.boolean().default(false),
  description: z.string().max(1000).default(""),
  owner: z.string().max(160).default(""),
  note: z.string().max(1000).optional(),
});
const keyParam = z.object({ key: z.string().min(1).max(160) });
const idParam = z.object({ id: z.string().uuid() });
const rejectBody = z.object({ reason: z.string().min(3).max(1000) });
const listChangesQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) });

function serializeEntry(row: ConfigEntryRow): Record<string, unknown> {
  return {
    id: row.id,
    key: row.key,
    value: displayValue(row.value, row.encrypted),
    sensitive: row.sensitive,
    encrypted: row.encrypted,
    description: row.description,
    owner: row.owner,
    version: row.version,
    updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt),
    updatedBy: row.updatedBy,
  };
}

function serializeChange(row: ConfigChangeRow): Record<string, unknown> {
  return {
    id: row.id,
    key: row.key,
    proposedValue: displayValue(row.proposedValue, row.encrypted),
    sensitive: row.sensitive,
    encrypted: row.encrypted,
    description: row.description,
    owner: row.owner,
    note: row.note,
    status: row.status,
    proposedBy: row.proposedBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString?.() ?? null,
    rejectedReason: row.rejectedReason,
    baseVersion: row.baseVersion,
    createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt),
  };
}

function serializeVersion(row: ConfigVersionRow): Record<string, unknown> {
  return {
    version: row.version,
    value: displayValue(row.value, row.encrypted),
    sensitive: row.sensitive,
    encrypted: row.encrypted,
    note: row.note,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString?.() ?? String(row.approvedAt),
  };
}

async function audit(tx: Tx, ctx: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "admin", action, resourceType: "central_config", resourceId, outcome: "success" },
  });
}

export async function apply_central_config_0(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/central-config/changes"
    const body = proposeBody.parse(req.body);
    const { stored, encrypted } = sealForStorage(body.value, body.sensitive, configKey());

    const change = await db.transaction(async (tx) => {
      const existing = await repo.findEntryByKeyTx(tx as repo.Writer, ctx.tenantId, body.key);
      const row = await repo.insertChange(tx as repo.Writer, {
        tenantId: ctx.tenantId,
        key: body.key,
        proposedValue: stored,
        sensitive: body.sensitive,
        encrypted,
        description: body.description,
        owner: body.owner,
        note: body.note ?? null,
        status: "pending",
        proposedBy: ctx.actorId,
        baseVersion: existing?.version ?? null,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await audit(tx, ctx, "config.change.proposed", row.id);
      return row;
    });
    return;
  
}

export async function apply_central_config_1(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/central-config/changes/:id/approve"
    const { id } = idParam.parse(req.params);

    const result = await db.transaction(async (tx) => {
      const change = await repo.findChangeByIdTx(tx as repo.Writer, id, ctx.tenantId);
      if (!change) throw new HttpError(404, "NOT_FOUND", "change request not found");
      assertPending(change.status);
      assertApproverDistinct(change.proposedBy, ctx.actorId);

      const existing = await repo.findEntryByKeyTx(tx as repo.Writer, ctx.tenantId, change.key);
      let entryId: string;
      let version: number;
      if (existing) {
        version = nextVersion(existing.version);
        entryId = existing.id;
        await repo.updateEntry(tx as repo.Writer, existing.id, ctx.tenantId, {
          value: change.proposedValue,
          sensitive: change.sensitive,
          encrypted: change.encrypted,
          description: change.description,
          owner: change.owner,
          version,
          updatedBy: ctx.actorId,
        });
      } else {
        version = 1;
        const created = await repo.insertEntry(tx as repo.Writer, {
          tenantId: ctx.tenantId,
          key: change.key,
          value: change.proposedValue,
          sensitive: change.sensitive,
          encrypted: change.encrypted,
          description: change.description,
          owner: change.owner,
          version,
          createdBy: change.proposedBy,
          updatedBy: ctx.actorId,
        });
        entryId = created.id;
      }

      await repo.insertVersion(tx as repo.Writer, {
        tenantId: ctx.tenantId,
        entryId,
        key: change.key,
        version,
        value: change.proposedValue,
        sensitive: change.sensitive,
        encrypted: change.encrypted,
        note: change.note,
        approvedBy: ctx.actorId,
      });

      await repo.updateChange(tx as repo.Writer, id, ctx.tenantId, {
        status: "approved",
        approvedBy: ctx.actorId,
        approvedAt: new Date(),
        updatedBy: ctx.actorId,
      });

      await audit(tx, ctx, "config.change.approved", id);
      return { key: change.key, version };
    });
    return;
  
}

export async function apply_central_config_2(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/central-config/changes/:id/reject"
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body);

    await db.transaction(async (tx) => {
      const change = await repo.findChangeByIdTx(tx as repo.Writer, id, ctx.tenantId);
      if (!change) throw new HttpError(404, "NOT_FOUND", "change request not found");
      assertPending(change.status);
      await repo.updateChange(tx as repo.Writer, id, ctx.tenantId, {
        status: "rejected",
        rejectedReason: body.reason,
        updatedBy: ctx.actorId,
      });
      await audit(tx, ctx, "config.change.rejected", id);
    });
    return;
  
}

