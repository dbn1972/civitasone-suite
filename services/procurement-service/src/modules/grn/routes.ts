import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { GRNSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createGrnBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin", "store_officer"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];

export async function grnRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/grns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, GRNSummaryListSchema, await queries.listGrns(ctx.tenantId, q.limit, q.offset));
  });

  app.post("/v1/procurement/grns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createGrnBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createGrn(ctx, body));
  });

  app.get("/v1/procurement/grns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const grn = await queries.getGrn(id, ctx.tenantId);
    if (!grn) throw new HttpError(404, "NOT_FOUND", "GRN not found");
    return reply.send(grn);
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
