import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  caseIdParam, noticeIdParam,
  issueNoticeBody, recordServiceBody, updateNoticeStatusBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const NOTICE_WRITE_ROLES = ["registrar", "court_admin", "bailiff", "super_admin"];
const NOTICE_READ_ROLES = ["registrar", "court_admin", "bailiff", "court_clerk", "judge", "super_admin"];

export async function noticeRoutes(app: FastifyInstance): Promise<void> {
  // Issue a notice on a case.
  app.post("/v1/court/cases/:id/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = issueNoticeBody.parse(req.body);
    const result = await commands.issueNotice(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's notices.
  app.get("/v1/court/cases/:id/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const items = await repo.listNoticesByCase(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Record a service attempt against a notice.
  app.post("/v1/court/notices/:id/service", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_WRITE_ROLES);
    const { id } = noticeIdParam.parse(req.params);
    const body = recordServiceBody.parse(req.body);
    const result = await commands.recordService(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a notice's service attempts.
  app.get("/v1/court/notices/:id/service", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_READ_ROLES);
    const { id } = noticeIdParam.parse(req.params);
    const items = await repo.listServiceByNotice(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Update a notice's lifecycle status.
  app.patch("/v1/court/notices/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_WRITE_ROLES);
    const { id } = noticeIdParam.parse(req.params);
    const body = updateNoticeStatusBody.parse(req.body);
    const result = await commands.updateNoticeStatus(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "notice route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
