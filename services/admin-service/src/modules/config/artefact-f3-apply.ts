/** Auto-generated F3 apply (config). */

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
 */
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

export async function apply_config_0(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/config-artefacts"
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

    const created = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const currentMax = await repo.maxArtefactVersionTx(w, ctx.tenantId, body.setKey);
      if (currentMax !== null) {
        const latest = await repo.findArtefactByVersionTx(w, ctx.tenantId, body.setKey, currentMax);
        if (latest?.checksum === checksum) {
          // Refuse to mint a new version that is byte-identical to the current
          // head: artefact numbers must mean something in a promotion audit.
          throw new HttpError(409, "ARTEFACT_UNCHANGED",
            `config set is identical to version ${currentMax}; nothing to snapshot`);
        }
      }
      const artefactVersion = nextArtefactVersion(currentMax);
      const row = await repo.insertArtefact(w, {
        tenantId: ctx.tenantId,
        setKey: body.setKey,
        artefactVersion,
        entries,
        checksum,
        note: body.note ?? null,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await domainEvent(tx, outboxCtx(ctx), EVENTS.configArtefactSnapshotted, {
        artefactId: row.id, setKey: row.setKey, artefactVersion, checksum,
      });
      await auditEvent(tx, outboxCtx(ctx), "config_artefact.snapshot", RESOURCE, row.id, {
        setKey: row.setKey, artefactVersion,
      });
      return row;
    });
    return;
  
}

export async function apply_config_1(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/config-artefacts/promotions"
    const body = parseOrThrow(promoteBody, req.body);

    const created = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const artefact = await repo.findArtefactByVersionTx(w, ctx.tenantId, body.setKey, body.artefactVersion);
      if (!artefact) throw new HttpError(404, "NOT_FOUND", "config artefact version not found");
      const row = await repo.insertPromotion(w, {
        tenantId: ctx.tenantId,
        setKey: body.setKey,
        artefactId: artefact.id,
        artefactVersion: artefact.artefactVersion,
        targetEnv: body.targetEnv,
        kind: "promote",
        status: "pending",
        requestedBy: ctx.actorId,
        note: body.note ?? null,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await domainEvent(tx, outboxCtx(ctx), EVENTS.configPromotionRequested, {
        promotionId: row.id, setKey: row.setKey, artefactVersion: row.artefactVersion, targetEnv: row.targetEnv,
      });
      await auditEvent(tx, outboxCtx(ctx), "config_promotion.requested", RESOURCE, row.id, {
        setKey: row.setKey, artefactVersion: row.artefactVersion, targetEnv: row.targetEnv,
      });
      return row;
    });
    return;
  
}

export async function apply_config_2(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/config-artefacts/promotions/:id/approve"
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(decideBody, req.body);

    const result = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const promotion = await repo.findPromotionByIdTx(w, ctx.tenantId, id);
      if (!promotion) throw new HttpError(404, "NOT_FOUND", "promotion not found");
      assertPendingPromotion(promotion.status);
      // Separation of duties BEFORE the optimistic-lock check so a maker trying
      // to self-approve always gets the SoD answer, never a version answer.
      assertApproverDistinct(promotion.requestedBy, ctx.actorId);
      assertVersionMatch(promotion.version, body.expectedVersion);

      const decided = await repo.decidePromotion(w, ctx.tenantId, id, body.expectedVersion, {
        status: "promoted",
        approvedBy: ctx.actorId,
        approvedAt: new Date(),
        updatedBy: ctx.actorId,
      });
      if (!decided) {
        throw new HttpError(409, "VERSION_CONFLICT", "promotion was modified concurrently; re-read and retry");
      }

      const existing = await repo.findEnvStateTx(w, ctx.tenantId, promotion.setKey, promotion.targetEnv);
      let envVersion: number;
      if (!existing) {
        const inserted = await repo.insertEnvState(w, {
          tenantId: ctx.tenantId,
          setKey: promotion.setKey,
          environment: promotion.targetEnv,
          artefactId: promotion.artefactId,
          artefactVersion: promotion.artefactVersion,
          promotedBy: ctx.actorId,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        });
        envVersion = inserted.version;
      } else {
        const moved = await repo.updateEnvState(w, ctx.tenantId, existing.id, existing.version, {
          artefactId: promotion.artefactId,
          artefactVersion: promotion.artefactVersion,
          promotedBy: ctx.actorId,
          updatedBy: ctx.actorId,
        });
        if (!moved) {
          throw new HttpError(409, "VERSION_CONFLICT", "environment state was modified concurrently; re-read and retry");
        }
        envVersion = existing.version + 1;
      }

      await domainEvent(tx, outboxCtx(ctx), EVENTS.configArtefactPromoted, {
        promotionId: promotion.id,
        setKey: promotion.setKey,
        artefactId: promotion.artefactId,
        artefactVersion: promotion.artefactVersion,
        environment: promotion.targetEnv,
        approvedBy: ctx.actorId,
        requestedBy: promotion.requestedBy,
      });
      await auditEvent(tx, outboxCtx(ctx), "config_promotion.approved", RESOURCE, promotion.id, {
        setKey: promotion.setKey, artefactVersion: promotion.artefactVersion,
        environment: promotion.targetEnv, requestedBy: promotion.requestedBy,
      });
      return {
        promotionId: promotion.id,
        status: "promoted",
        setKey: promotion.setKey,
        environment: promotion.targetEnv,
        artefactVersion: promotion.artefactVersion,
        envStateVersion: envVersion,
      };
    });
    return;
  
}

export async function apply_config_3(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/config-artefacts/promotions/:id/reject"
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(rejectBody, req.body);

    const result = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const promotion = await repo.findPromotionByIdTx(w, ctx.tenantId, id);
      if (!promotion) throw new HttpError(404, "NOT_FOUND", "promotion not found");
      assertPendingPromotion(promotion.status);
      assertApproverDistinct(promotion.requestedBy, ctx.actorId);
      assertVersionMatch(promotion.version, body.expectedVersion);
      const decided = await repo.decidePromotion(w, ctx.tenantId, id, body.expectedVersion, {
        status: "rejected",
        rejectedReason: body.reason,
        updatedBy: ctx.actorId,
      });
      if (!decided) {
        throw new HttpError(409, "VERSION_CONFLICT", "promotion was modified concurrently; re-read and retry");
      }
      await domainEvent(tx, outboxCtx(ctx), EVENTS.configPromotionRejected, {
        promotionId: promotion.id, setKey: promotion.setKey, targetEnv: promotion.targetEnv,
      });
      await auditEvent(tx, outboxCtx(ctx), "config_promotion.rejected", RESOURCE, promotion.id);
      return { promotionId: promotion.id, status: "rejected" };
    });
    return;
  
}

export async function apply_config_4(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/config-artefacts/environments/:env/rollback"
    const { env } = parseOrThrow(envParam, req.params);
    const body = parseOrThrow(rollbackBody, req.body);

    const result = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const state = await repo.findEnvStateTx(w, ctx.tenantId, body.setKey, env);
      if (!state) throw new HttpError(404, "NOT_FOUND", "no config artefact is live in this environment for that set");
      assertVersionMatch(state.version, body.expectedVersion);
      const target = await repo.findArtefactByVersionTx(w, ctx.tenantId, body.setKey, body.toVersion);
      if (!target) throw new HttpError(404, "NOT_FOUND", "rollback target artefact version not found");
      assertRollbackIsBackwards(state.artefactVersion, body.toVersion);
      const promoted = await repo.promotedVersionsTx(w, ctx.tenantId, body.setKey, env);
      assertRollbackTargetPreviouslyPromoted(promoted, body.toVersion);

      const moved = await repo.updateEnvState(w, ctx.tenantId, state.id, body.expectedVersion, {
        artefactId: target.id,
        artefactVersion: target.artefactVersion,
        promotedBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      if (!moved) {
        throw new HttpError(409, "VERSION_CONFLICT", "environment state was modified concurrently; re-read and retry");
      }
      const record = await repo.insertPromotion(w, {
        tenantId: ctx.tenantId,
        setKey: body.setKey,
        artefactId: target.id,
        artefactVersion: target.artefactVersion,
        targetEnv: env,
        kind: "rollback",
        status: "promoted",
        requestedBy: ctx.actorId,
        approvedBy: ctx.actorId,
        approvedAt: new Date(),
        note: `rollback from version ${state.artefactVersion}`,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await domainEvent(tx, outboxCtx(ctx), EVENTS.configArtefactRolledBack, {
        promotionId: record.id,
        setKey: body.setKey,
        environment: env,
        fromVersion: state.artefactVersion,
        toVersion: target.artefactVersion,
      });
      await auditEvent(tx, outboxCtx(ctx), "config_artefact.rolled_back", RESOURCE, record.id, {
        setKey: body.setKey, environment: env,
        fromVersion: state.artefactVersion, toVersion: target.artefactVersion,
      });
      return {
        setKey: body.setKey,
        environment: env,
        fromVersion: state.artefactVersion,
        toVersion: target.artefactVersion,
        envStateVersion: body.expectedVersion + 1,
      };
    });
    return;
  
}

