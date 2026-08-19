import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as periodRepo from "./repo.js";
import * as commands from "./commands.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function isPeriodHardClosed(tenantId: string, period: string): Promise<boolean> {
  return periodRepo.isPeriodHardClosedDb(tenantId, period);
}

export async function getPeriodStatus(tenantId: string, period: string): Promise<string> {
  return periodRepo.getPeriodStatusDb(tenantId, period);
}

export async function periodCloseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/periods/:period/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { period } = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM") }).parse(req.params);

    const existing = await periodRepo.findPeriodClose(ctx.tenantId, period);
    if (existing?.status === "hard_close") {
      throw new HttpError(409, "ALREADY_CLOSED", "period is already hard-closed");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.closePeriod(ctx, period, "soft_close"));
  });

  app.post("/v1/finance/periods/:period/hard-close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { period } = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM") }).parse(req.params);

    const existing = await periodRepo.findPeriodClose(ctx.tenantId, period);
    if (existing?.status === "hard_close") {
      throw new HttpError(409, "ALREADY_CLOSED", "period is already hard-closed");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.closePeriod(ctx, period, "hard_close"));
  });

  app.post("/v1/finance/periods/:period/reopen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["finance_admin", "super_admin"]);
    const { period } = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM") }).parse(req.params);
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});

    const existing = await periodRepo.findPeriodClose(ctx.tenantId, period);
    if (!existing || existing.status === "open") {
      throw new HttpError(409, "NOT_CLOSED", "period is already open");
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.reopenPeriod(ctx, period, body.reason),
    );
  });

  app.get("/v1/finance/periods", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await periodRepo.listPeriodClose(ctx.tenantId, q.limit);
    return reply.send({ data: rows.slice(q.offset, q.offset + q.limit), total: rows.length });
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
