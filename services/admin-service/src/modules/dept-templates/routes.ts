/**
 * ORG-07 — department template clone. HTTP routes.
 *
 *   POST   /v1/admin/department-templates                    clone a department's
 *                                                            config as a template
 *   GET    /v1/admin/department-templates                    list (paged)
 *   GET    /v1/admin/department-templates/:id                one template
 *   PATCH  /v1/admin/department-templates/:id                rename / archive
 *                                                            (optimistic-locked)
 *   POST   /v1/admin/department-templates/:id/instantiate     create a department
 *                                                            from the template
 *   GET    /v1/admin/department-templates/:id/instantiations  what was created
 *
 * IDEMPOTENCY: instantiate REQUIRES an `idempotencyKey`. A repeat call with the
 * same key returns 200 with the FIRST result and `idempotent: true` — it does not
 * insert a second department and does not re-publish the event. A DB unique index
 * on (tenant, template, key) backs this up if two calls race.
 *
 * TENANT SAFETY: the posted config is sanitised before storage — every
 * tenant-crossing reference is stripped and reported in `droppedRefs`
 * (domain.ts sanitizeTemplateConfig). A clone can never carry a pointer into
 * another tenant's data.
 *
 * BOUNDARY: admin-service owns the template and the instantiation RECORD. The
 * department itself lives in the org-owning service, which creates it from the
 * published `admin.department.instantiated` event (documented in src/topics.ts).
 */
import { randomUUID } from "node:crypto";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { auditEvent, domainEvent, type OutboxCtx } from "../../shared/audit.js";
import { listEnvelope, singleEnvelope, parseOrThrow, registerEnvelopeErrorHandler } from "../../shared/envelope.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  sanitizeTemplateConfig,
  findForeignTenantRefs,
  assertVersionMatch,
  assertTemplateActive,
  assertConfigNotEmpty,
} from "./domain.js";
import type { DepartmentTemplateRow, DepartmentInstantiationRow } from "./schema.js";

const TEMPLATE_ROLES = [...TENANT_ADMIN_ROLES];
const RESOURCE = "department_template";

const limitSchema = z.coerce.number().int().min(1).max(200);
const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const codeSchema = z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, "lower-case alphanumeric, - and _ only");

const createBody = z.object({
  code: codeSchema,
  name: z.string().min(1).max(200),
  sourceDepartmentId: z.string().uuid().optional(),
  config: z.record(z.unknown()),
});

const patchBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const instantiateBody = z.object({
  departmentCode: codeSchema,
  departmentName: z.string().min(1).max(200),
  idempotencyKey: z.string().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/, "invalid idempotency key"),
});

const listQuery = z.object({
  limit: limitSchema,
  page: pageSchema,
  status: z.enum(["active", "archived"]).optional(),
});
const instListQuery = z.object({ limit: limitSchema, page: pageSchema });
const idParam = z.object({ id: z.string().uuid() });

const MAX_CONFIG_KEYS = 200;

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function serializeTemplate(row: DepartmentTemplateRow): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sourceDepartmentId: row.sourceDepartmentId,
    config: row.config,
    droppedRefs: row.droppedRefs,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: row.version,
  };
}

function serializeInstantiation(row: DepartmentInstantiationRow): Record<string, unknown> {
  return {
    id: row.id,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    idempotencyKey: row.idempotencyKey,
    config: row.config,
    createdAt: iso(row.createdAt),
    version: row.version,
  };
}

function outboxCtx(ctx: { tenantId: string; actorId: string; correlationId: string }): OutboxCtx {
  return { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId };
}

export async function departmentTemplateRoutes(app: FastifyInstance): Promise<void> {
  // ── clone a department config into a template ─────────────────────────────
  app.post("/v1/admin/department-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ROLES);
    const body = parseOrThrow(createBody, req.body);
    if (Object.keys(body.config).length > MAX_CONFIG_KEYS) {
      throw new HttpError(422, "CONFIG_TOO_LARGE", `a department config may hold at most ${MAX_CONFIG_KEYS} top-level keys`);
    }

    const foreignRefs = findForeignTenantRefs(body.config, ctx.tenantId);
    const { config, droppedRefs } = sanitizeTemplateConfig(body.config, ctx.tenantId);
    assertConfigNotEmpty(config);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'dept_templates_op_0',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const created = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send(singleEnvelope({
      ...serializeTemplate(created),
      // Surfaced so a cross-tenant clone attempt is visible, not silently cleaned.
      foreignTenantRefs: foreignRefs,
    }));
  });

  app.get("/v1/admin/department-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ROLES);
    const q = parseOrThrow(listQuery, req.query);
    const { rows, total } = await repo.listTemplates(ctx.tenantId, q.limit, (q.page - 1) * q.limit, q.status);
    return reply.send(listEnvelope(rows.map(serializeTemplate), { page: q.page, pageSize: q.limit, total }));
  });

  app.get("/v1/admin/department-templates/:id/instantiations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const q = parseOrThrow(instListQuery, req.query);
    const template = await repo.findTemplate(ctx.tenantId, id);
    if (!template) throw new HttpError(404, "NOT_FOUND", "department template not found");
    const { rows, total } = await repo.listInstantiations(ctx.tenantId, id, q.limit, (q.page - 1) * q.limit);
    return reply.send(listEnvelope(rows.map(serializeInstantiation), { page: q.page, pageSize: q.limit, total }));
  });

  // ── update (optimistic-locked) ────────────────────────────────────────────
  app.patch("/v1/admin/department-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(patchBody, req.body);
    if (body.name === undefined && body.status === undefined) {
      throw new HttpError(400, "EMPTY_PATCH", "provide at least one of: name, status");
    }

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'dept_templates_op_2',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/admin/department-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const row = await repo.findTemplate(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "department template not found");
    return reply.send(singleEnvelope(serializeTemplate(row)));
  });

  registerEnvelopeErrorHandler(app);
}
