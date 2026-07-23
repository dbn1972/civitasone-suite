/**
 * checklist module — HTTP routes (Fastify plugin `registerChecklistRoutes`, 7 endpoints).
 *
 * Follows the suite CQRS + envelope conventions (structure.md, steering):
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish
 *              (checklist/commands.ts) → 202 `{ data: Accepted }`. Routes NEVER write to
 *              Postgres directly; the checklist consumer applies the change and emits the
 *              outbox event.
 *   • READS  — cache-first `repo.*` lookups (checklist/repo.ts). Single entity → `{ data }`;
 *              lists → `{ data, meta: { page, pageSize, total } }`.
 *
 * Error paths (app-level `registerSchemaErrorHandler` maps them):
 *   • zod parse failure → 400 VALIDATION_FAILED
 *   • `resolveContext`  → 401 for unauthenticated callers
 *   • `requireRole`     → 403 FORBIDDEN
 *   • unknown / other-tenant id → 404 NOT_FOUND
 *
 * RBAC (design.md § API Routes — Checklist Module):
 *   • inspection_admin  — POST (create/publish templates)
 *   • inspector         — POST instances, PATCH instances (submit responses)
 *   • inspector, inspection_admin, reviewing_officer — GET (read)
 *
 * Endpoints (7):
 *   POST   /v1/inspection/checklists/templates           create checklist template
 *   POST   /v1/inspection/checklists/templates/:id/publish  publish template
 *   GET    /v1/inspection/checklists/templates/:id       get template by ID
 *   GET    /v1/inspection/checklists/templates           list templates (paginated)
 *   POST   /v1/inspection/checklists/instances           generate checklist instance
 *   PATCH  /v1/inspection/checklists/instances/:id       submit response to instance
 *   GET    /v1/inspection/checklists/instances/:id       get instance by ID
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishTemplateCreate,
  publishTemplatePublish,
  publishInstanceGenerate,
  publishInstanceSubmitResponse,
  type TemplateCreatePayload,
  type InstanceGeneratePayload,
  type InstanceSubmitResponsePayload,
} from "./commands.js";
import {
  findTemplateById,
  findTemplatesByTenant,
  findInstanceById,
} from "./repo.js";

// ─── RBAC role groups ────────────────────────────────────────────────────────

/** Write access for templates: only inspection administrators. */
const TEMPLATE_WRITE_ROLES = ["inspection_admin", "tenant_admin", "super_admin"];

/** Write access for instances: inspectors generate and submit responses. */
const INSTANCE_WRITE_ROLES = ["inspector", "inspection_admin", "tenant_admin", "super_admin"];

/** Read access for templates: inspectors and admins. */
const TEMPLATE_READ_ROLES = ["inspector", "inspection_admin", "tenant_admin", "super_admin"];

/** Read access for instances: inspectors, admins, and reviewing officers. */
const INSTANCE_READ_ROLES = ["inspector", "inspection_admin", "reviewing_officer", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** Question schema inside a section. */
const questionSchema = z.object({
  fieldType: z.enum(["text", "number", "boolean", "select", "multi_select", "photo", "signature", "geo_point"], {
    errorMap: () => ({ message: "fieldType must be one of: text, number, boolean, select, multi_select, photo, signature, geo_point" }),
  }),
  label: z.string().min(1, "label is required"),
  validationRules: z.record(z.unknown()).optional(),
  helpText: z.string().optional(),
  weight: z.number().nonnegative().optional(),
});

/** POST /v1/inspection/checklists/templates — create template (Req 5.1). */
const createTemplateSchema = z.object({
  name: z.string().min(1, "name is required"),
  inspectionTypeId: z.string().uuid().optional(),
  sections: z.array(z.object({
    title: z.string().min(1, "section title is required"),
    questions: z.array(questionSchema).min(1, "each section must have at least one question"),
  })).min(1, "at least one section is required"),
});

/** POST /v1/inspection/checklists/templates/:id/publish — publish template (Req 5.2). */
const publishTemplateSchema = z.object({
  version: z.number().int().nonnegative("version must be a non-negative integer"),
});

/** POST /v1/inspection/checklists/instances — generate instance (Req 5.3). */
const generateInstanceSchema = z.object({
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
  templateId: z.string().uuid("templateId must be a valid UUID"),
  templateVersion: z.number().int().positive("templateVersion must be a positive integer"),
});

/** PATCH /v1/inspection/checklists/instances/:id — submit responses (Req 5.5). */
const submitResponseSchema = z.object({
  responses: z.array(z.object({
    questionId: z.string().min(1, "questionId is required"),
    value: z.unknown(),
    capturedAt: z.string().optional(),
  })).min(1, "at least one response is required"),
});

/** Shared pagination query schema (offset-based, max 200 per API standards). */
const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

/** Reusable UUID path param schema. */
const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerChecklistRoutes(app: FastifyInstance): Promise<void> {
  // ── Templates ───────────────────────────────────────────────────────────

  /** POST /v1/inspection/checklists/templates — create a checklist template (Req 5.1). */
  app.post("/v1/inspection/checklists/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_WRITE_ROLES);
    const body = createTemplateSchema.parse(req.body) as TemplateCreatePayload;
    const result = await publishTemplateCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** POST /v1/inspection/checklists/templates/:id/publish — publish a template (Req 5.2). */
  app.post("/v1/inspection/checklists/templates/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    // Verify template exists before publishing command
    const template = await findTemplateById(ctx.tenantId, id);
    if (!template) throw new HttpError(404, "NOT_FOUND", "checklist template not found");
    const body = publishTemplateSchema.parse(req.body);
    const result = await publishTemplatePublish({ templateId: id, version: body.version }, ctx);
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/checklists/templates/:id — get template by ID (Req 5.7). */
  app.get("/v1/inspection/checklists/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_READ_ROLES);
    const { id } = idParam.parse(req.params);
    const template = await findTemplateById(ctx.tenantId, id);
    if (!template) throw new HttpError(404, "NOT_FOUND", "checklist template not found");
    return reply.send({ data: template });
  });

  /** GET /v1/inspection/checklists/templates — list templates (paginated). */
  app.get("/v1/inspection/checklists/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_READ_ROLES);
    const { page, pageSize } = paginationQuery.parse(req.query);
    const result = await findTemplatesByTenant(ctx.tenantId, { page, pageSize });
    return reply.send(result);
  });

  // ── Instances ───────────────────────────────────────────────────────────

  /** POST /v1/inspection/checklists/instances — generate a checklist instance (Req 5.3). */
  app.post("/v1/inspection/checklists/instances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSTANCE_WRITE_ROLES);
    const body = generateInstanceSchema.parse(req.body) as InstanceGeneratePayload;
    const result = await publishInstanceGenerate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** PATCH /v1/inspection/checklists/instances/:id — submit responses (Req 5.5). */
  app.patch("/v1/inspection/checklists/instances/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSTANCE_WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    // Verify instance exists before publishing command
    const instance = await findInstanceById(ctx.tenantId, id);
    if (!instance) throw new HttpError(404, "NOT_FOUND", "checklist instance not found");
    const body = submitResponseSchema.parse(req.body);
    const result = await publishInstanceSubmitResponse(
      { instanceId: id, responses: body.responses } as InstanceSubmitResponsePayload,
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/checklists/instances/:id — get instance by ID. */
  app.get("/v1/inspection/checklists/instances/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSTANCE_READ_ROLES);
    const { id } = idParam.parse(req.params);
    const instance = await findInstanceById(ctx.tenantId, id);
    if (!instance) throw new HttpError(404, "NOT_FOUND", "checklist instance not found");
    return reply.send({ data: instance });
  });
}
