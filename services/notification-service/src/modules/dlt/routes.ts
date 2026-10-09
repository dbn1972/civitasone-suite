import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDltTemplateBody, updateDltTemplateBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

/**
 * GAP2-NOTIFICATIONS-DLT-10: DLT (TRAI) template registration is a regulated
 * mutation. Per CLAUDE.md CQRS the route may NOT write to Postgres directly
 * and every mutation must emit an audit event. These write routes now
 * validate (zod), publish a command to the bus, and return 202 Accepted; the
 * consumer applies the write via the transactional outbox and emits the audit
 * event in the same transaction (see consumer.ts). The read routes stay as
 * direct cache/DB reads, like every other module.
 */
export async function dltRoutes(app: FastifyInstance): Promise<void> {
  // POST /notifications/dlt-templates — register a DLT template (async)
  app.post("/notifications/dlt-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const parsed = createDltTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const body = parsed.data;

    // Synchronous uniqueness pre-check so a duplicate is a clean 409 rather
    // than an async consumer rejection the caller never sees.
    const existing = await repo.findByTemplateAndChannel(ctx.tenantId, body.templateId, body.channel);
    if (existing) {
      throw new HttpError(409, "DLT_TEMPLATE_EXISTS", "DLT template already registered for this tenant/channel");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createDltTemplate(ctx, body));
  });

  // GET /notifications/dlt-templates — list registered templates
  app.get("/notifications/dlt-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    const rows = await repo.findAll(ctx.tenantId);
    return reply.send({ data: rows });
  });

  // GET /notifications/dlt-templates/:id — get one
  app.get("/notifications/dlt-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "DLT template not found");
    return reply.send({ data: row });
  });

  // PATCH /notifications/dlt-templates/:id — update status (async)
  app.patch("/notifications/dlt-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = req.params as { id: string };
    const parsed = updateDltTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "DLT template not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDltTemplate(ctx, id, parsed.data));
  });

  // DELETE /notifications/dlt-templates/:id — remove (async)
  app.delete("/notifications/dlt-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = req.params as { id: string };

    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "DLT template not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteDltTemplate(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
