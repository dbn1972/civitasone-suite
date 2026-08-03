import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./supplementary-repo.js";
import {
  assertSupplementaryValid, assertValidSupplementaryKind,
} from "./supplementary-domain.js";
import { DomainError } from "./domain.js";
import { createSupplementaryBody, rejectSupplementaryBody, supplementaryQuery, idParam } from "./supplementary-validators.js";
import type { SupplementaryDemandRow } from "./supplementary-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];
const APPROVER_ROLES = ["finance_admin", "super_admin"];

function toDomain(err: unknown, status = 400): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

export async function supplementaryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/supplementary-demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createSupplementaryBody.parse(req.body);
    try {
      assertValidSupplementaryKind(body.kind);
      assertSupplementaryValid({
        amountMinor: BigInt(body.amountMinor), authority: body.authority, limitMinor: BigInt(body.limitMinor),
      });
    } catch (err) { toDomain(err); }
    const id = randomUUID();
    await queue.publish(COMMANDS.supplementaryCreate, {
      messageId: id, type: COMMANDS.supplementaryCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId, fy: body.fy, budgetId: body.budgetId, headId: body.headId,
        amountMinor: body.amountMinor, limitMinor: body.limitMinor, currency: body.currency,
        kind: body.kind, authority: body.authority, reason: body.reason,
        effectiveFrom: body.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.get("/v1/finance/supplementary-demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = supplementaryQuery.parse(req.query);
    const rows = await repo.listSupplementary(ctx.tenantId, { fy: q.fy, status: q.status, budgetId: q.budgetId }, q.limit);
    return reply.send({ data: rows.map(serialize) });
  });

  app.get("/v1/finance/supplementary-demands/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findSupplementaryById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "supplementary demand not found");
    return reply.send({ data: serialize(row) });
  });

  app.patch("/v1/finance/supplementary-demands/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const messageId = randomUUID();
    await queue.publish(COMMANDS.supplementaryApprove, {
      messageId, type: COMMANDS.supplementaryApprove,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.patch("/v1/finance/supplementary-demands/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectSupplementaryBody.parse(req.body);
    const messageId = randomUUID();
    await queue.publish(COMMANDS.supplementaryReject, {
      messageId, type: COMMANDS.supplementaryReject,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, reason: body.reason },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

function serialize(r: SupplementaryDemandRow) {
  return {
    id: r.id, fy: r.fy, budgetId: r.budgetId, headId: r.headId,
    amountMinor: r.amountMinor.toString(), limitMinor: r.limitMinor.toString(),
    currency: r.currency, kind: r.kind, authority: r.authority, reason: r.reason,
    status: r.status, approvedBy: r.approvedBy, rejectReason: r.rejectReason,
    effectiveFrom: r.effectiveFrom, version: r.version,
  };
}
