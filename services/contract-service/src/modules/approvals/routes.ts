import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createApprovalLevelBody,
  updateApprovalLevelBody,
  approvalLevelIdParam,
  approvalLevelListQuery,
  resolveApprovalQuery,
} from "./validators.js";
import { resolveApprovalLevel, MAX_APPROVAL_LEVELS } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["super_admin", "tenant_admin", "finance_admin", "contract_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer", "legal_officer"];

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  // ── Resolve approval level for a contract value ───────────────────────
  // NOTE: This route must be registered BEFORE the /:id route to avoid path collision
  app.get("/v1/contract/approval-levels/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { contractValue } = resolveApprovalQuery.parse(req.query);
    const value = BigInt(contractValue);

    const { data } = await repo.listApprovalLevels(ctx.tenantId, { limit: MAX_APPROVAL_LEVELS, offset: 0 });

    const levels = data.map((d) => ({
      minValuePaise: d.minValuePaise,
      requiredRole: d.requiredRole,
    }));

    const resolved = resolveApprovalLevel(value, levels);

    if (!resolved) {
      return reply.send({ data: null, message: "no approval level matches the given contract value" });
    }

    return reply.send({
      data: {
        minValuePaise: resolved.minValuePaise.toString(),
        requiredRole: resolved.requiredRole,
      },
    });
  });

  // ── Create approval level — queue-first CQRS write ────────────────────
  app.post("/v1/contract/approval-levels", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createApprovalLevelBody.parse(req.body);

    // Enforce max 5 levels (pre-publish read-only validation)
    const count = await repo.countApprovalLevels(ctx.tenantId);
    if (count >= MAX_APPROVAL_LEVELS) {
      throw new HttpError(422, "LEVEL_LIMIT_REACHED", `maximum ${MAX_APPROVAL_LEVELS} approval levels allowed`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createApprovalLevel(ctx, count + 1, body));
  });

  // ── List approval levels ──────────────────────────────────────────────
  app.get("/v1/contract/approval-levels", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = approvalLevelListQuery.parse(req.query);

    const { data, total } = await repo.listApprovalLevels(ctx.tenantId, {
      limit: q.limit,
      offset: q.offset,
    });

    // Serialize bigint for JSON response
    const serialized = data.map((d) => ({
      ...d,
      minValuePaise: d.minValuePaise.toString(),
    }));

    return reply.send({
      data: serialized,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── Get single approval level ─────────────────────────────────────────
  app.get("/v1/contract/approval-levels/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = approvalLevelIdParam.parse(req.params);

    const level = await repo.getApprovalLevelById(id, ctx.tenantId);
    if (!level) {
      throw new HttpError(404, "NOT_FOUND", "approval level not found");
    }

    return reply.send({
      data: { ...level, minValuePaise: level.minValuePaise.toString() },
    });
  });

  // ── Update approval level — queue-first CQRS write ────────────────────
  app.patch("/v1/contract/approval-levels/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = approvalLevelIdParam.parse(req.params);
    const body = updateApprovalLevelBody.parse(req.body);

    const existing = await repo.getApprovalLevelById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "approval level not found");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateApprovalLevel(ctx, id, body.version, body));
  });

  // ── Delete approval level — queue-first CQRS write ────────────────────
  app.delete("/v1/contract/approval-levels/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = approvalLevelIdParam.parse(req.params);

    const existing = await repo.getApprovalLevelById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "approval level not found");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteApprovalLevel(ctx, id));
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
