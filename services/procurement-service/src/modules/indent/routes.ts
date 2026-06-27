import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createIndentBody, approveIndentBody, rejectIndentBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];

export async function indentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/indents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createIndentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createIndent(ctx, body));
  });

  app.patch("/v1/procurement/indents/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    if (!ctx.roles.includes("super_admin")) {
      throw new HttpError(403, "WORKFLOW_REQUIRED", "Approve indent via workflow task inbox (/procurement/approvals)");
    }
    const { id } = idParam.parse(req.params);
    const body = approveIndentBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveIndent(ctx, id, body));
  });

  app.patch("/v1/procurement/indents/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectIndentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectIndent(ctx, id, body));
  });

  app.get("/v1/procurement/indents/tender-required", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await queries.listTenderRequiredIndents(ctx.tenantId);
    return reply.send({ data: rows.map((r) => ({ ...r, totalMinor: String(r.totalMinor) })) });
  });

  app.get("/v1/procurement/indents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const list = await queries.listIndents(ctx.tenantId, q.limit, q.offset);
    return reply.send(list);
  });

  app.get("/v1/procurement/indents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const indent = await queries.getIndent(id, ctx.tenantId);
    if (!indent) throw new HttpError(404, "NOT_FOUND", "indent not found");
    return reply.send(indent);
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
