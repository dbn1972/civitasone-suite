import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createRenewalBody, updateRenewalBody, renewalIdParam, renewalListQuery } from "./validators.js";
import { computeRenewalNotices } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function renewalRoutes(app: FastifyInstance): Promise<void> {
  // ── Create renewal config — queue-first CQRS write ────────────────────
  app.post("/v1/contract/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createRenewalBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRenewal(ctx, body));
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

  // ── Update renewal — queue-first CQRS write ───────────────────────────
  app.patch("/v1/contract/renewals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = renewalIdParam.parse(req.params);
    const body = updateRenewalBody.parse(req.body);

    const existing = await repo.getRenewalById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "renewal not found");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateRenewal(ctx, id, body.version, body));
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
