import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { validateTemplate, evaluateGate, toggleItem } from "./domain.js";

const USER = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin", "case_manager"];
const ADMIN = ["workflow_admin", "super_admin", "tenant_admin", "case_manager"];

export async function checklistsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/workflow/checklist-templates", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const data = await repo.listTemplates(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.put("/v1/workflow/checklist-templates/:code", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(200),
      items: z.array(z.object({ key: z.string().min(1).max(64), label: z.string().min(1).max(200), required: z.boolean().default(false) })).min(1),
    }).parse(req.body);
    const v = validateTemplate(body.items);
    if (!v.allowed) throw new HttpError(400, "INVALID_TEMPLATE", v.errors.join(", "));
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertChecklistTemplate(ctx, {
      code, name: body.name, items: body.items,
    }));
  });

  app.post("/v1/workflow/checklists", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const body = z.object({
      templateId: z.string().uuid(),
      entityType: z.string().min(1).max(48),
      entityId: z.string().uuid(),
    }).parse(req.body);
    const tpl = await repo.findTemplate(ctx.tenantId, body.templateId);
    if (!tpl) throw new HttpError(404, "NOT_FOUND", "template not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.createChecklistInstance(ctx, body));
  });

  app.get("/v1/workflow/checklists", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const q = z.object({ entityType: z.string().min(1), entityId: z.string().uuid() }).parse(req.query);
    const rows = await repo.listInstancesForEntity(ctx.tenantId, q.entityType, q.entityId);
    return reply.send({ data: rows.map((r) => ({ ...r, gate: evaluateGate(r.items) })), meta: { total: rows.length } });
  });

  app.post("/v1/workflow/checklists/:id/items/:key", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const params = z.object({ id: z.string().uuid(), key: z.string().min(1).max(64) }).parse(req.params);
    const body = z.object({ checked: z.boolean() }).parse(req.body);
    const inst = await repo.findInstance(ctx.tenantId, params.id);
    if (!inst) throw new HttpError(404, "NOT_FOUND", "checklist not found");
    const res = toggleItem(inst.items, params.key, body.checked, ctx.actorId, new Date().toISOString());
    if (!res.found) throw new HttpError(404, "ITEM_NOT_FOUND", "checklist item not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.toggleChecklistItem(ctx, {
      instanceId: params.id, key: params.key, checked: body.checked,
    }));
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
