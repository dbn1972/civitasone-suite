import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { createDltTemplateBody, updateDltTemplateBody } from "./validators.js";
import * as repo from "./repo.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function dltRoutes(app: FastifyInstance): Promise<void> {
  // POST /notifications/dlt-templates — register a DLT template
  app.post("/notifications/dlt-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const parsed = createDltTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const body = parsed.data;

    try {
      const row = await db.transaction(async (tx) => {
        return repo.insert(tx, {
          tenantId: ctx.tenantId,
          entityId: body.entityId,
          templateId: body.templateId,
          headerId: body.headerId,
          contentType: body.contentType,
          templateBody: body.templateBody,
          channel: body.channel,
          status: body.status ?? "active",
          registeredAt: body.registeredAt ? new Date(body.registeredAt) : null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        });
      });

      return reply.status(201).send({ data: row });
    } catch (err: unknown) {
      // Unique constraint violation — template already registered
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
        throw new HttpError(409, "DLT_TEMPLATE_EXISTS", "DLT template already registered for this tenant/channel");
      }
      throw err;
    }
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

  // PATCH /notifications/dlt-templates/:id — update status
  app.patch("/notifications/dlt-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = req.params as { id: string };
    const parsed = updateDltTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const body = parsed.data;

    const updated = await db.transaction(async (tx) => {
      return repo.updateStatus(
        tx,
        ctx.tenantId,
        id,
        body.status ?? "active",
        body.expiresAt === null ? null : body.expiresAt ? new Date(body.expiresAt) : undefined,
        ctx.actorId,
      );
    });

    if (!updated) throw new HttpError(404, "NOT_FOUND", "DLT template not found");
    return reply.send({ data: updated });
  });

  // DELETE /notifications/dlt-templates/:id — remove
  app.delete("/notifications/dlt-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = req.params as { id: string };

    const deleted = await db.transaction(async (tx) => {
      return repo.remove(tx, ctx.tenantId, id);
    });

    if (!deleted) throw new HttpError(404, "NOT_FOUND", "DLT template not found");
    return reply.status(204).send();
  });
}
