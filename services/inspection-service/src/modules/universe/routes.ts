/**
 * universe module — HTTP routes (Fastify plugin `registerUniverseRoutes`, 10 endpoints).
 *
 * Follows the suite CQRS + envelope conventions (structure.md, steering):
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish
 *              (universe/commands.ts) → 202 `{ data: Accepted }`. Routes NEVER write to
 *              Postgres directly; the universe consumer applies the change and emits the
 *              outbox event.
 *   • READS  — cache-first `repo.*` lookups (universe/repo.ts) or full-text search
 *              (universe/queries.ts). Single entity → `{ data }`; lists →
 *              `{ data, meta: { page, pageSize, total } }`.
 *
 * Error paths (no per-route handler — the app-level `registerSchemaErrorHandler` maps them):
 *   • zod parse failure → 400 VALIDATION_FAILED
 *   • `resolveContext`  → 401 for unauthenticated callers
 *   • `requireRole`     → 403 FORBIDDEN
 *   • unknown / other-tenant id → 404 NOT_FOUND
 *   • optimistic-lock clash on a queued write → 409 VERSION_CONFLICT (from the consumer)
 *
 * RBAC (design.md § API Routes — Universe Module):
 *   • inspection_admin  — POST/PATCH (create/update master data)
 *   • inspector, inspection_admin — GET (read/search)
 *
 * Endpoints (10):
 *   POST   /v1/inspection/entities              create regulated entity
 *   PATCH  /v1/inspection/entities/:id          update regulated entity
 *   GET    /v1/inspection/entities/:id          get entity by ID
 *   GET    /v1/inspection/entities              search/list entities (full-text + pagination)
 *   POST   /v1/inspection/types                 create inspection type
 *   GET    /v1/inspection/types                 list inspection types
 *   POST   /v1/inspection/provisions            create provision
 *   GET    /v1/inspection/provisions            list provisions
 *   POST   /v1/inspection/vocabularies          upsert vocabulary entry
 *   GET    /v1/inspection/vocabularies          list vocabularies by category
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishEntityCreate,
  publishEntityUpdate,
  publishInspectionTypeCreate,
  publishProvisionCreate,
  publishVocabularyUpsert,
  type EntityCreatePayload,
  type InspectionTypeCreatePayload,
  type ProvisionCreatePayload,
  type VocabularyUpsertPayload,
} from "./commands.js";
import {
  findEntityById,
  findInspectionTypesByTenant,
  findProvisionsByTenant,
  findVocabulariesByTenant,
} from "./repo.js";
import { searchEntities } from "./queries.js";

// ─── RBAC role groups (design § API Routes — Universe Module) ────────────────

/** Write access: only inspection administrators may create/update master data. */
const WRITE_ROLES = ["inspection_admin", "tenant_admin", "super_admin"];

/** Read access: inspectors and inspection administrators. */
const READ_ROLES = ["inspector", "inspection_admin", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** POST /v1/inspection/entities — create regulated entity (Req 2.1). */
const createEntitySchema = z.object({
  registrationNo: z.string().min(1, "registrationNo is required"),
  entityType: z.string().min(1, "entityType is required"),
  name: z.string().min(1, "name is required"),
  jurisdiction: z.string().min(1, "jurisdiction is required"),
  addressLine1: z.string().min(1, "addressLine1 is required"),
  addressLine2: z.string().optional(),
  city: z.string().min(1, "city is required"),
  state: z.string().min(1, "state is required"),
  pincode: z.string().min(1, "pincode is required").max(10),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  riskCategory: z.string().min(1, "riskCategory is required"),
  metadata: z.record(z.unknown()).optional(),
});

/** PATCH /v1/inspection/entities/:id — update entity (Req 2.2). */
const updateEntitySchema = z.object({
  version: z.number().int().nonnegative("version must be a non-negative integer"),
  patch: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
    message: "patch must contain at least one field",
  }),
});

/** POST /v1/inspection/types — create inspection type (Req 2.4). */
const createInspectionTypeSchema = z.object({
  code: z.string().min(1, "code is required"),
  name: z.string().min(1, "name is required"),
  applicableEntityTypes: z.array(z.string().min(1)).min(1, "at least one entity type required"),
  requiredCompetencies: z.array(z.string().min(1)).min(1, "at least one competency required"),
  defaultTemplateIds: z.array(z.string().uuid()).optional(),
  regulatoryBasis: z.unknown().optional(),
});

/** POST /v1/inspection/provisions — create provision (Req 2.5). */
const createProvisionSchema = z.object({
  actReference: z.string().min(1, "actReference is required"),
  sectionNumber: z.string().min(1, "sectionNumber is required"),
  description: z.string().min(1, "description is required"),
  penaltyClause: z.string().optional(),
  severityClassification: z.enum(["critical", "major", "minor", "observation"], {
    errorMap: () => ({ message: "severityClassification must be one of: critical, major, minor, observation" }),
  }),
});

/** POST /v1/inspection/vocabularies — upsert vocabulary entry (Req 2.6). */
const upsertVocabularySchema = z.object({
  category: z.string().min(1, "category is required"),
  code: z.string().min(1, "code is required"),
  label: z.string().min(1, "label is required"),
  description: z.string().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
});

/** Shared pagination query schema (offset-based, max 200 per API standards). */
const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

/** GET /v1/inspection/entities — search/list with optional query + filters. */
const searchEntitiesQuery = paginationQuery.extend({
  q: z.string().optional(),
  entityType: z.string().optional(),
  riskCategory: z.string().optional(),
  jurisdiction: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

/** GET /v1/inspection/vocabularies — filter by category. */
const listVocabulariesQuery = paginationQuery.extend({
  category: z.string().optional(),
});

/** Reusable UUID path param schema. */
const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerUniverseRoutes(app: FastifyInstance): Promise<void> {
  // ── Regulated Entities ──────────────────────────────────────────────────

  /** POST /v1/inspection/entities — create a regulated entity (Req 2.1). */
  app.post("/v1/inspection/entities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createEntitySchema.parse(req.body) as EntityCreatePayload;
    const result = await publishEntityCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** PATCH /v1/inspection/entities/:id — update a regulated entity (Req 2.2). */
  app.patch("/v1/inspection/entities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    // Verify entity exists and belongs to this tenant before publishing command
    const entity = await findEntityById(ctx.tenantId, id);
    if (!entity) throw new HttpError(404, "NOT_FOUND", "regulated entity not found");
    const body = updateEntitySchema.parse(req.body);
    const result = await publishEntityUpdate({ entityId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/entities/:id — get entity by ID via cache (Req 2.7). */
  app.get("/v1/inspection/entities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const entity = await findEntityById(ctx.tenantId, id);
    if (!entity) throw new HttpError(404, "NOT_FOUND", "regulated entity not found");
    return reply.send({ data: entity });
  });

  /** GET /v1/inspection/entities — full-text search + pagination (Req 2.7). */
  app.get("/v1/inspection/entities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { q, page, pageSize } = searchEntitiesQuery.parse(req.query);
    const result = await searchEntities(ctx.tenantId, q ?? "", { page, pageSize });
    return reply.send(result);
  });

  // ── Inspection Types ────────────────────────────────────────────────────

  /** POST /v1/inspection/types — create inspection type (Req 2.4). */
  app.post("/v1/inspection/types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createInspectionTypeSchema.parse(req.body) as InspectionTypeCreatePayload;
    const result = await publishInspectionTypeCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/types — list inspection types (paginated). */
  app.get("/v1/inspection/types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { page, pageSize } = paginationQuery.parse(req.query);
    const result = await findInspectionTypesByTenant(ctx.tenantId, { page, pageSize });
    return reply.send(result);
  });

  // ── Provisions ──────────────────────────────────────────────────────────

  /** POST /v1/inspection/provisions — create provision (Req 2.5). */
  app.post("/v1/inspection/provisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createProvisionSchema.parse(req.body) as ProvisionCreatePayload;
    const result = await publishProvisionCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/provisions — list provisions (paginated). */
  app.get("/v1/inspection/provisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { page, pageSize } = paginationQuery.parse(req.query);
    const result = await findProvisionsByTenant(ctx.tenantId, { page, pageSize });
    return reply.send(result);
  });

  // ── Vocabularies ────────────────────────────────────────────────────────

  /** POST /v1/inspection/vocabularies — upsert vocabulary entry (Req 2.6). */
  app.post("/v1/inspection/vocabularies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = upsertVocabularySchema.parse(req.body) as VocabularyUpsertPayload;
    const result = await publishVocabularyUpsert(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/vocabularies — list vocabularies by category (paginated, Req 2.6). */
  app.get("/v1/inspection/vocabularies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { page, pageSize, category } = listVocabulariesQuery.parse(req.query);
    const result = await findVocabulariesByTenant(ctx.tenantId, category, { page, pageSize });
    return reply.send(result);
  });
}
