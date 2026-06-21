import { sendValidated } from "@civitasone/schemas/validate";
import { TenderSummaryListSchema, TenderDetailSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];
const idParam      = z.object({ id: z.string().uuid() });

export async function tenderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const limit  = Math.min(Number((req.query as { limit?: string }).limit ?? 100), 200);
    const offset = Number((req.query as { offset?: string }).offset ?? 0);
    sendValidated(reply, TenderSummaryListSchema, await queries.listTenders(ctx.tenantId, limit, offset));
  });

  app.get("/v1/procurement/tenders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getTenderDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "tender not found");
    sendValidated(reply, TenderDetailSchema, detail);
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
