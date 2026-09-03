/**
 * WC-010 — configuration-as-artefact HTTP routes.
 *
 * Treats a configuration SET as a build artefact:
 *   snapshot  → immutable, checksummed config_artefacts row (version N)
 *   diff      → leaf-path diff between any two versions of the same set
 *   promote   → maker-checker request, then a DIFFERENT actor approves; the
 *               approval is what moves config_env_state for the target env
 *   rollback  → restore an EARLIER, already-approved version of the same set
 *
 * Write pattern follows central-config/routes.ts: the write runs synchronously
 * inside one db.transaction and its audit record + domain event are enqueued on
 * the transactional outbox in that SAME transaction. No command topic is
 * published, so there is no consumer that could re-write a row this route
 * already wrote.
 *
 * Optimistic locking: every mutating decision takes `expectedVersion` and the
 * UPDATE carries `WHERE version = $expected`; a mismatch is 409 VERSION_CONFLICT.
 *
 * SYNCHRONOUS PRE-ACCEPT VALIDATION: every mutating route here is F3 -- it
 * accepts a write with a 202 before the mutation actually runs (applied later
 * by artefact-f3-consumer.ts / artefact-f3-apply.ts from the outbox).
 * publishAdminCommand is fire-and-forget and cannot reject, so the
 * existence/uniqueness/state/maker-checker/optimistic-lock guards below are
 * lifted synchronously -- read-only, via the repo's scopedRead-backed
 * lookups -- from the EXACT same checks apply_config_0..4 run in
 * artefact-f3-apply.ts, in the same order, so the synchronous and async
 * paths agree. A TOCTOU race remains between these reads and the consumer's
 * write (same residual risk documented in uploads/doc-routes.ts and
 * integration-settings/routes.ts); the consumer's own checks (and the DB's
 * optimistic-lock WHERE clauses) are the backstop for that.
 */
import { randomUUID } from "node:crypto";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, requireSuperAdmin, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { auditEvent, domainEvent, type OutboxCtx } from "../../shared/audit.js";
import { listEnvelope, singleEnvelope, parseOrThrow, registerEnvelopeErrorHandler } from "../../shared/envelope.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./artefact-repo.js";
import {
  ENVIRONMENTS,
  checksumOf,
  diffConfig,
  nextArtefactVersion,
  assertApproverDistinct,
  assertPendingPromotion,
  assertVersionMatch,
  assertRollbackTargetPreviouslyPromoted,
  assertRollbackIsBackwards,
  canonicalJson,
  type ConfigEntries,
} from "./artefact-domain.js";
import type { ConfigArtefactRow, ConfigPromotionRow, ConfigEnvStateRow } from "./artefact-schema.js";

const ARTEFACT_ROLES = [...TENANT_ADMIN_ROLES];
const RESOURCE = "config_artefact";

/** Guards against a client shipping a multi-megabyte config blob. */
const MAX_ENTRIES_KEYS = 500;
const MAX_ENTRIES_BYTES = 256_000;

const setKeySchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/, "invalid set key");
const limitSchema = z.coerce.number().int().min(1).max(200);
const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);

const snapshotBody = z.object({
  setKey: setKeySchema,
  entries: z.record(z.unknown()),
  note: z.string().max(1000).optional(),
});

const listQuery = z.object({
  limit: limitSchema,
  page: pageSchema,
  setKey: setKeySchema.optional(),
});

const promotionListQuery = z.object({
  limit: limitSchema,
  page: pageSchema,
  status: z.enum(["pending", "promoted", "rejected"]).optional(),
});

const envListQuery = z.object({ limit: limitSchema, page: pageSchema });

const diffQuery = z.object({
  setKey: setKeySchema,
  fromVersion: z.coerce.number().int().min(1),
  toVersion: z.coerce.number().int().min(1),
});

const promoteBody = z.object({
  setKey: setKeySchema,
  artefactVersion: z.coerce.number().int().min(1),
  targetEnv: z.enum(ENVIRONMENTS),
  note: z.string().max(1000).optional(),
});

const decideBody = z.object({ expectedVersion: z.coerce.number().int().min(1) });
const rejectBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  reason: z.string().min(3).max(1000),
});

const rollbackBody = z.object({
  setKey: setKeySchema,
  toVersion: z.coerce.number().int().min(1),
  expectedVersion: z.coerce.number().int().min(1),
});

const idParam = z.object({ id: z.string().uuid() });
const envParam = z.object({ env: z.enum(ENVIRONMENTS) });

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function serializeArtefact(row: ConfigArtefactRow): Record<string, unknown> {
  return {
    id: row.id,
    setKey: row.setKey,
    artefactVersion: row.artefactVersion,
    entries: row.entries,
    checksum: row.checksum,
    note: row.note,
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    version: row.version,
  };
}

function serializePromotion(row: ConfigPromotionRow): Record<string, unknown> {
  return {
    id: row.id,
    setKey: row.setKey,
    artefactId: row.artefactId,
    artefactVersion: row.artefactVersion,
    targetEnv: row.targetEnv,
    kind: row.kind,
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    rejectedReason: row.rejectedReason,
    note: row.note,
    createdAt: iso(row.createdAt),
    version: row.version,
  };
}

function serializeEnvState(row: ConfigEnvStateRow): Record<string, unknown> {
  return {
    id: row.id,
    setKey: row.setKey,
    environment: row.environment,
    artefactId: row.artefactId,
    artefactVersion: row.artefactVersion,
    promotedBy: row.promotedBy,
    promotedAt: iso(row.promotedAt),
    version: row.version,
  };
}

function outboxCtx(ctx: { tenantId: string; actorId: string; correlationId: string }): OutboxCtx {
  return { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId };
}

export async function configArtefactRoutes(app: FastifyInstance): Promise<void> {
  // ── snapshot a config set as an immutable artefact version ────────────────
  app.post("/v1/admin/config-artefacts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const body = parseOrThrow(snapshotBody, req.body);

    const entries = body.entries as ConfigEntries;
    if (Object.keys(entries).length > MAX_ENTRIES_KEYS) {
      throw new HttpError(422, "ARTEFACT_TOO_LARGE", `a config set may hold at most ${MAX_ENTRIES_KEYS} top-level keys`);
    }
    const canonical = canonicalJson(entries);
    if (Buffer.byteLength(canonical, "utf8") > MAX_ENTRIES_BYTES) {
      throw new HttpError(422, "ARTEFACT_TOO_LARGE", `a config set may not exceed ${MAX_ENTRIES_BYTES} bytes`);
    }
    const checksum = checksumOf(entries);

    // Same guard apply_config_0 runs (409 ARTEFACT_UNCHANGED when the new set
    // is byte-identical to the current head), lifted synchronously.
    const currentMax = await repo.maxArtefactVersion(ctx.tenantId, body.setKey);
    if (currentMax !== null) {
      const latest = await repo.findArtefactByVersion(ctx.tenantId, body.setKey, currentMax);
      if (latest?.checksum === checksum) {
        throw new HttpError(409, "ARTEFACT_UNCHANGED",
          `config set is identical to version ${currentMax}; nothing to snapshot`);
      }
    }

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'config_op_0',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const created = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── list artefact versions ────────────────────────────────────────────────
  app.get("/v1/admin/config-artefacts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const q = parseOrThrow(listQuery, req.query);
    const { rows, total } = await repo.listArtefacts(ctx.tenantId, q.limit, (q.page - 1) * q.limit, q.setKey);
    return reply.send(listEnvelope(rows.map(serializeArtefact), { page: q.page, pageSize: q.limit, total }));
  });

  // ── diff two versions of a set ────────────────────────────────────────────
  app.get("/v1/admin/config-artefacts/diff", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const q = parseOrThrow(diffQuery, req.query);
    const [from, to] = await Promise.all([
      repo.findArtefactByVersion(ctx.tenantId, q.setKey, q.fromVersion),
      repo.findArtefactByVersion(ctx.tenantId, q.setKey, q.toVersion),
    ]);
    if (!from) throw new HttpError(404, "NOT_FOUND", `artefact version ${q.fromVersion} not found for this set`);
    if (!to) throw new HttpError(404, "NOT_FOUND", `artefact version ${q.toVersion} not found for this set`);
    const diff = diffConfig(from.entries, to.entries);
    return reply.send(singleEnvelope({
      setKey: q.setKey,
      fromVersion: from.artefactVersion,
      toVersion: to.artefactVersion,
      ...diff,
    }));
  });

  // ── list promotions (maker-checker queue) ─────────────────────────────────
  app.get("/v1/admin/config-artefacts/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const q = parseOrThrow(promotionListQuery, req.query);
    const { rows, total } = await repo.listPromotions(ctx.tenantId, q.limit, (q.page - 1) * q.limit, q.status);
    return reply.send(listEnvelope(rows.map(serializePromotion), { page: q.page, pageSize: q.limit, total }));
  });

  // ── request a promotion (the MAKER half) ──────────────────────────────────
  app.post("/v1/admin/config-artefacts/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const body = parseOrThrow(promoteBody, req.body);

    // Same existence guard apply_config_1 runs (404 NOT_FOUND when the
    // referenced artefact version does not exist), lifted synchronously.
    const artefact = await repo.findArtefactByVersion(ctx.tenantId, body.setKey, body.artefactVersion);
    if (!artefact) throw new HttpError(404, "NOT_FOUND", "config artefact version not found");

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'config_op_1',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const created = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── approve a promotion (the CHECKER half — applies it) ───────────────────
  app.post("/v1/admin/config-artefacts/promotions/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(decideBody, req.body);

    // Same guards apply_config_2 runs, in the same order, lifted
    // synchronously: the promotion must exist (404 NOT_FOUND), still be
    // pending (409 NOT_PENDING), the approver must differ from the requester
    // (409 MAKER_CHECKER_VIOLATION -- checked before the optimistic lock so a
    // maker trying to self-approve always gets the SoD answer, never a
    // version answer), and expectedVersion must match (409 VERSION_CONFLICT).
    const promotion = await repo.findPromotionById(ctx.tenantId, id);
    if (!promotion) throw new HttpError(404, "NOT_FOUND", "promotion not found");
    assertPendingPromotion(promotion.status);
    assertApproverDistinct(promotion.requestedBy, ctx.actorId);
    assertVersionMatch(promotion.version, body.expectedVersion);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'config_op_2',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── reject a promotion ───────────────────────────────────────────────────
  app.post("/v1/admin/config-artefacts/promotions/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(rejectBody, req.body);

    // Same guards apply_config_3 runs, in the same order, lifted
    // synchronously (see the approve route above for the rationale).
    const promotion = await repo.findPromotionById(ctx.tenantId, id);
    if (!promotion) throw new HttpError(404, "NOT_FOUND", "promotion not found");
    assertPendingPromotion(promotion.status);
    assertApproverDistinct(promotion.requestedBy, ctx.actorId);
    assertVersionMatch(promotion.version, body.expectedVersion);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'config_op_3',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── what is live in each environment ─────────────────────────────────────
  app.get("/v1/admin/config-artefacts/environments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const q = parseOrThrow(envListQuery, req.query);
    const { rows, total } = await repo.listEnvState(ctx.tenantId, q.limit, (q.page - 1) * q.limit);
    return reply.send(listEnvelope(rows.map(serializeEnvState), { page: q.page, pageSize: q.limit, total }));
  });

  /**
   * Roll an environment back to an EARLIER artefact version.
   *
   * Deliberately NOT maker-checker'd, and restricted to super_admin /
   * platform_admin instead: a rollback can only target a version this tenant's
   * own maker-checker already approved into this very environment (enforced by
   * assertRollbackTargetPreviouslyPromoted), so it introduces no unreviewed
   * config. Requiring a second approver during an incident would make the
   * documented recovery path unusable. The action is fully audited and recorded
   * as a config_promotions row with kind='rollback'.
   */
  app.post("/v1/admin/config-artefacts/environments/:env/rollback", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { env } = parseOrThrow(envParam, req.params);
    const body = parseOrThrow(rollbackBody, req.body);

    // Same guards apply_config_4 runs, in the same order, lifted
    // synchronously: an artefact must be live in this environment for the
    // set (404 NOT_FOUND), the env-state expectedVersion must match (409
    // VERSION_CONFLICT), the rollback target version must exist (404
    // NOT_FOUND), it must be strictly earlier than the live version (422
    // NOT_A_ROLLBACK), and it must have been previously promoted to this
    // environment (422 ROLLBACK_TARGET_NOT_PROMOTED).
    const state = await repo.findEnvState(ctx.tenantId, body.setKey, env);
    if (!state) throw new HttpError(404, "NOT_FOUND", "no config artefact is live in this environment for that set");
    assertVersionMatch(state.version, body.expectedVersion);
    const target = await repo.findArtefactByVersion(ctx.tenantId, body.setKey, body.toVersion);
    if (!target) throw new HttpError(404, "NOT_FOUND", "rollback target artefact version not found");
    assertRollbackIsBackwards(state.artefactVersion, body.toVersion);
    const promoted = await repo.promotedVersions(ctx.tenantId, body.setKey, env);
    assertRollbackTargetPreviouslyPromoted(promoted, body.toVersion);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'config_op_4',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── single artefact (registered last: static siblings win in the router) ──
  app.get("/v1/admin/config-artefacts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ARTEFACT_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const row = await repo.findArtefactById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "config artefact not found");
    return reply.send(singleEnvelope(serializeArtefact(row)));
  });

  registerEnvelopeErrorHandler(app);
}
