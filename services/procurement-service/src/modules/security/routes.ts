import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  collectEmdBody, resolveEmdBody, collectPbgBody, resolvePbgBody, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];

export async function securityRoutes(app: FastifyInstance): Promise<void> {
  // ── EMD ──────────────────────────────────────────────────────────────────
  app.get("/v1/procurement/emd", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send({ items: await queries.listEmd(ctx.tenantId, q.limit, q.offset) });
  });
  app.get("/v1/procurement/emd/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await queries.getEmd(id, ctx.tenantId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "emd not found");
    return reply.send(r);
  });
  app.post("/v1/procurement/emd", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, PROC_ROLES);
    const body = collectEmdBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.collectEmd(ctx, body));
  });
  app.post("/v1/procurement/emd/:id/forfeit", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveEmdBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.forfeitEmd(ctx, id, body));
  });
  app.post("/v1/procurement/emd/:id/refund", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveEmdBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.refundEmd(ctx, id, body));
  });

  // ── PBG ──────────────────────────────────────────────────────────────────
  app.get("/v1/procurement/pbg", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send({ items: await queries.listPbg(ctx.tenantId, q.limit, q.offset) });
  });
  app.get("/v1/procurement/pbg/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await queries.getPbg(id, ctx.tenantId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "pbg not found");
    return reply.send(r);
  });
  app.post("/v1/procurement/pbg", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, PROC_ROLES);
    const body = collectPbgBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.collectPbg(ctx, body));
  });
  app.post("/v1/procurement/pbg/:id/forfeit", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolvePbgBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.forfeitPbg(ctx, id, body));
  });
  app.post("/v1/procurement/pbg/:id/release", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolvePbgBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.releasePbg(ctx, id, body));
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
