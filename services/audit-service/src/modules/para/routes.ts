import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { deptResponseBody, settleBody, pendingRecoveryBody, closeBody, idParam, listParasQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

/**
 * UAT W8-C: tenant-scoped existence read (uncached, through db.transaction so the RLS GUC is set) before a
 * para command is published: an unknown para is a 404, not a 202 for a command that can never apply. The
 * consumer stays the race-safe check for state.
 */
async function assertParaExists(id: string, tenantId: string): Promise<void> {
  if (!(await repo.findParaById(id, tenantId))) throw new HttpError(404, "NOT_FOUND", "para not found");
}

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];
const DEPT_ROLES  = ["dept_head", "dept_officer", ...AUDIT_ROLES];
const READER_ROLES = [...AUDIT_ROLES, "finance_admin", "dept_head"];

export async function paraRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/audit/paras/:id/issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    await assertParaExists(id, ctx.tenantId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.issuePara(ctx, id));
  });

  app.post("/v1/audit/paras/:id/response", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DEPT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = deptResponseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deptResponse(ctx, id, body));
  });

  app.patch("/v1/audit/paras/:id/settle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = settleBody.parse(req.body ?? {});
    await assertParaExists(id, ctx.tenantId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.settlePara(ctx, id, body));
  });

  app.patch("/v1/audit/paras/:id/pending_recovery", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = pendingRecoveryBody.parse(req.body ?? {});
    await assertParaExists(id, ctx.tenantId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.pendingRecovery(ctx, id, body));
  });

  app.patch("/v1/audit/paras/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeBody.parse(req.body ?? {});
    await assertParaExists(id, ctx.tenantId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closePara(ctx, id, body));
  });

  app.get("/v1/audit/paras", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listParasQuery.parse(req.query);
    return reply.send(await queries.listParas(ctx.tenantId, q.status, q.deptRef, q.limit, q.offset));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
