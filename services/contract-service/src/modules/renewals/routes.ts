import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createRenewalBody, updateRenewalBody, renewalIdParam, renewalListQuery } from "./validators.js";
import { computeRenewalNotices } from "./domain.js";
import * as repo from "./repo.js";
import { cache } from "../../shared/infra.js";

const WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function renewalRoutes(app: FastifyInstance): Promise<void> {
  // ── Create renewal config ─────────────────────────────────────────────
  app.post("/v1/contract/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createRenewalBody.parse(req.body);

    const notices = computeRenewalNotices(body.expiryDate, body.advanceNoticeDays);
    const id = randomUUID();

    const renewal = await repo.insertRenewal({
      id,
      tenantId: ctx.tenantId,
      contractId: body.contractId,
      expiryDate: body.expiryDate,
      advanceNoticeDays: body.advanceNoticeDays,
      status: "active",
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });

    return reply.code(201).send({
      id: renewal.id,
      status: "created",
      notices,
      correlationId: ctx.correlationId,
    });
  });

  // ── List renewals ─────────────────────────────────────────────────────
  app.get("/v1/contract/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = renewalListQuery.parse(req.query);

    const { data, total } = await repo.listRenewals(ctx.tenantId, {
      ...(q.contractId !== undefined && { contractId: q.contractId }),
      ...(q.status !== undefined && { status: q.status }),
      limit: q.limit,
      offset: q.offset,
    });

    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── Get single renewal ────────────────────────────────────────────────
  app.get("/v1/contract/renewals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = renewalIdParam.parse(req.params);

    const renewal = await repo.getRenewalById(id, ctx.tenantId);
    if (!renewal) {
      throw new HttpError(404, "NOT_FOUND", "renewal not found");
    }

    const notices = computeRenewalNotices(renewal.expiryDate, renewal.advanceNoticeDays);

    return reply.send({ data: { ...renewal, notices } });
  });

  // ── Update renewal ────────────────────────────────────────────────────
  app.patch("/v1/contract/renewals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = renewalIdParam.parse(req.params);
    const body = updateRenewalBody.parse(req.body);

    const existing = await repo.getRenewalById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "renewal not found");
    }

    const updateData: Parameters<typeof repo.updateRenewal>[3] = {
      updatedBy: ctx.actorId,
    };
    if (body.advanceNoticeDays !== undefined) updateData.advanceNoticeDays = body.advanceNoticeDays;
    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === "renewed") {
        updateData.renewedAt = new Date();
        updateData.renewedBy = ctx.actorId;
      }
    }

    const updated = await repo.updateRenewal(id, ctx.tenantId, body.version, updateData);
    if (!updated) {
      throw new HttpError(409, "VERSION_CONFLICT", "renewal was modified by another request");
    }

    await cache.invalidate(cache.makeKey(ctx.tenantId, "renewal", id));

    return reply.code(202).send({
      id: updated.id,
      status: "updated",
      correlationId: ctx.correlationId,
    });
  });

  // ── Error handler ─────────────────────────────────────────────────────
  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
