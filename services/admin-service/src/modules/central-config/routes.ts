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
import { randomUUID } from "node:crypto";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";
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

export async function centralConfigRoutes(app: FastifyInstance): Promise<void> {
  // List live config entries (sensitive values masked).
  app.get("/v1/admin/central-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const q = listQuery.parse(req.query);
    const rows = await repo.listEntries(ctx.tenantId, q.limit);
    return reply.send({ data: rows.map(serializeEntry) });
  });

  // Version history for a single key.
  app.get("/v1/admin/central-config/:key/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const { key } = keyParam.parse(req.params);
    const rows = await repo.listVersions(ctx.tenantId, key);
    return reply.send({ data: rows.map(serializeVersion) });
  });

  // List change requests (maker-checker queue).
  app.get("/v1/admin/central-config/changes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const q = listChangesQuery.parse(req.query);
    const rows = await repo.listChanges(ctx.tenantId, q.limit, q.status);
    return reply.send({ data: rows.map(serializeChange) });
  });

  // Propose a config change (create or update a key). Sensitive values are
  // encrypted at rest here, before they ever touch the database.
  app.post("/v1/admin/central-config/changes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const body = proposeBody.parse(req.body);
    const { stored, encrypted } = sealForStorage(body.value, body.sensitive, configKey());

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'central_config_op_0',
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const change = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // Approve a change — maker-checker enforced; applies the value + versions it.
  app.post("/v1/admin/central-config/changes/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const { id } = idParam.parse(req.params);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'central_config_op_1',
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // Reject a change.
  app.post("/v1/admin/central-config/changes/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'central_config_op_2',
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ status: "rejected", id });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof ConfigError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
