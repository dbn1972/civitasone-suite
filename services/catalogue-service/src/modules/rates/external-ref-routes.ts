/**
 * PC-005 — rate tables as external masters.
 *
 * Recording a `{ sourceSystem, externalId, syncedAt }` reference marks the rate as
 * mastered outside CivitasOne: the local row becomes a synchronised replica whose
 * authoritative value lives in the named system. This is metadata about provenance
 * only; the rate value itself is still edited through the existing rates routes.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as externalRepo from "./external-ref-repo.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sourceSystem: z.string().min(1).max(128).optional(),
  productId: z.string().uuid().optional(),
});

const putBody = z.object({
  sourceSystem: z.string().min(1).max(128),
  externalId: z.string().min(1).max(200),
  syncedAt: z.string().datetime().optional(),
  /** Optional optimistic-lock guard. Falls back to the row's current version. */
  version: z.number().int().positive().optional(),
});

export async function rateExternalRefRoutes(app: FastifyInstance): Promise<void> {
  // ─── List rates with an external master ──────────────────────────────────────
  // Registered ahead of any `/rates/:id` sibling so `external-refs` is not
  // mistaken for a rate id.
  app.get("/v1/catalogue/rates/external-refs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await externalRepo.listExternalRefs({
      tenantId: ctx.tenantId,
      limit: q.limit,
      offset: q.offset,
      sourceSystem: q.sourceSystem,
      productId: q.productId,
    });
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        productId: r.productId,
        sourceSystem: r.sourceSystem,
        externalId: r.externalId,
        syncedAt: r.syncedAt,
        // MONEY RULE: bigint minor units serialised as a string.
        rateValueMinor: r.rateValue.toString(),
        effectiveFrom: r.effectiveDate,
        effectiveTo: r.effectiveTo,
        version: r.version,
      })),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // ─── Record the external master for a rate ───────────────────────────────────
  app.put("/v1/catalogue/rates/:id/external-ref", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = putBody.parse(req.body);

    const rate = await repo.findById(id, ctx.tenantId);
    if (!rate) throw new HttpError(404, "NOT_FOUND", "Rate not found");

    const syncedAt = body.syncedAt !== undefined ? new Date(body.syncedAt) : new Date();
    if (syncedAt.getTime() > Date.now() + 60_000) {
      // A sync timestamp in the future means the caller's clock is wrong or the
      // value was fabricated; either way it would corrupt staleness monitoring.
      throw new HttpError(422, "INVALID_SYNCED_AT", "syncedAt must not be in the future");
    }

    const expectedVersion = body.version ?? rate.version;

    await db.transaction(async (tx) => {
      const ok = await externalRepo.setExternalRef(tx, id, ctx.tenantId, {
        sourceSystem: body.sourceSystem,
        externalId: body.externalId,
        syncedAt,
        updatedBy: ctx.actorId,
      }, expectedVersion);
      if (!ok) throw new HttpError(409, "VERSION_CONFLICT", "Rate has been modified; retry with current version");

      await enqueue(tx, {
        topic: EVENTS.rateExternalRefRecorded,
        eventType: EVENTS.rateExternalRefRecorded,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          rateId: id,
          productId: rate.productId,
          sourceSystem: body.sourceSystem,
          externalId: body.externalId,
          syncedAt: syncedAt.toISOString(),
          previousVersion: expectedVersion,
        },
      });
    });

    return reply.send({
      data: {
        id,
        sourceSystem: body.sourceSystem,
        externalId: body.externalId,
        syncedAt: syncedAt.toISOString(),
        version: expectedVersion + 1,
      },
    });
  });
}
