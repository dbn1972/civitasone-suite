/**
 * DM-002 — document types, mandatory documents and expiry. HTTP routes.
 *
 *   POST  /v1/admin/document-types                define a type (expiry rules)
 *   GET   /v1/admin/document-types                list (paged)
 *   PATCH /v1/admin/document-types/:id            edit / retire (optimistic-locked)
 *   POST  /v1/admin/document-requirements         mark a type mandatory for a context
 *   GET   /v1/admin/document-requirements         list (paged, filterable)
 *   POST  /v1/admin/documents                     register an uploaded document
 *   GET   /v1/admin/documents                     list (paged, filterable)
 *   GET   /v1/admin/documents/compliance          mandatory-document check for a context
 *   POST  /v1/admin/documents/expiry-scan         classify expiries + EMIT ALERTS
 *
 * ALERTING BOUNDARY: expiry alerting is published as the events
 * 'admin.document.expiring' / 'admin.document.expired' on the transactional
 * outbox (contracts documented in src/topics.ts). notification-service owns the
 * channel and template and consumes them; admin-service does not send anything
 * itself and this sprint does not touch notification-service.
 *
 * The scan is an idempotent classifier: a document already in the right status
 * is left alone and no duplicate alert is emitted, so it is safe to run on a
 * schedule or by hand.
 *
 * SYNCHRONOUS PRE-ACCEPT VALIDATION: F3 routes accept a write with a 202/200
 * before the actual mutation runs (it is applied later by doc-f3-consumer.ts /
 * doc-f3-apply.ts against the outbox). publishAdminCommand is fire-and-forget
 * and cannot reject, so any existence/uniqueness/state check that only lived
 * in the consumer meant an invalid request got a false-positive "accepted"
 * while the write silently failed (or DLQ'd) downstream. The checks below are
 * lifted synchronously — read-only, via scopedRead — from the EXACT same
 * guards apply_uploads_0..3 run in doc-f3-apply.ts, so the synchronous and
 * async paths agree. A TOCTOU race remains between this read and the
 * consumer's write (same residual risk documented in hrms-service's cpf
 * routes); the DB's own constraints are the backstop for that rare race.
 */
import { randomUUID } from "node:crypto";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { auditEvent, domainEvent, type OutboxCtx } from "../../shared/audit.js";
import { listEnvelope, singleEnvelope, parseOrThrow, registerEnvelopeErrorHandler } from "../../shared/envelope.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./doc-repo.js";
import {
  DOCUMENT_CATEGORIES,
  classifyExpiry,
  daysUntil,
  evaluateCompliance,
  assertExpiryPresentWhenRequired,
  assertExpiryAfterIssue,
  assertExtensionAllowed,
  assertTypeActive,
  assertVersionMatch,
} from "./doc-domain.js";
import type { DocumentTypeRow, DocumentRequirementRow, DocumentRow } from "./doc-schema.js";

const DOC_ROLES = [...TENANT_ADMIN_ROLES, "hr_admin", "hr_officer", "officer", "manager"];
const ADMIN_ONLY = [...TENANT_ADMIN_ROLES];
const RESOURCE_TYPE = "document_type";
const RESOURCE_DOC = "document";

const limitSchema = z.coerce.number().int().min(1).max(200);
const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const codeSchema = z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, "lower-case alphanumeric, - and _ only");
const contextTypeSchema = z.string().min(2).max(48).regex(/^[a-z0-9_]+$/, "lower-case alphanumeric and _ only");
const contextKeySchema = z.string().min(1).max(120);

const typeBody = z.object({
  code: codeSchema,
  name: z.string().min(1).max(200),
  category: z.enum(DOCUMENT_CATEGORIES).default("document"),
  allowedExtensions: z.array(z.string().min(1).max(8).regex(/^[a-z0-9]+$/)).max(20).default([]),
  maxSizeMb: z.number().int().min(1).max(200).default(10),
  expiryRequired: z.boolean().default(false),
  expiryWarnDays: z.number().int().min(1).max(365).default(30),
});

const typePatchBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  name: z.string().min(1).max(200).optional(),
  maxSizeMb: z.number().int().min(1).max(200).optional(),
  expiryRequired: z.boolean().optional(),
  expiryWarnDays: z.number().int().min(1).max(365).optional(),
  status: z.enum(["active", "retired"]).optional(),
});

const requirementBody = z.object({
  contextType: contextTypeSchema,
  contextKey: contextKeySchema,
  documentTypeCode: codeSchema,
  mandatory: z.boolean().default(true),
});

const documentBody = z.object({
  documentTypeCode: codeSchema,
  contextType: contextTypeSchema,
  contextKey: contextKeySchema,
  subjectId: z.string().max(120).default(""),
  storageKey: z.string().min(3).max(1024),
  /**
   * 'offset: true' is required: zod's bare '.datetime()' accepts only a 'Z'
   * suffix, so a client submitting '2027-03-31T00:00:00+05:30' — a perfectly
   * unambiguous instant, and the natural form for an IST caller — was refused
   * with a 400. Both columns are 'timestamptz' and every comparison in
   * doc-domain.ts goes through 'new Date', so an offset stores and classifies as
   * exactly the same instant. 'Z' remains valid.
   */
  issuedAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const typeListQuery = z.object({
  limit: limitSchema, page: pageSchema, status: z.enum(["active", "retired"]).optional(),
});
const requirementListQuery = z.object({
  limit: limitSchema, page: pageSchema,
  contextType: contextTypeSchema.optional(), contextKey: contextKeySchema.optional(),
});
const documentListQuery = z.object({
  limit: limitSchema, page: pageSchema,
  contextType: contextTypeSchema.optional(), contextKey: contextKeySchema.optional(),
  subjectId: z.string().max(120).optional(),
  status: z.enum(["active", "expiring", "expired", "superseded"]).optional(),
});
const complianceQuery = z.object({
  limit: limitSchema,
  contextType: contextTypeSchema,
  contextKey: contextKeySchema,
  subjectId: z.string().max(120).optional(),
});
const scanBody = z.object({ limit: z.coerce.number().int().min(1).max(200).default(200) });
const idParam = z.object({ id: z.string().uuid() });

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function serializeType(row: DocumentTypeRow): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    allowedExtensions: row.allowedExtensions,
    maxSizeMb: row.maxSizeMb,
    expiryRequired: row.expiryRequired,
    expiryWarnDays: row.expiryWarnDays,
    status: row.status,
    version: row.version,
  };
}

function serializeRequirement(row: DocumentRequirementRow): Record<string, unknown> {
  return {
    id: row.id,
    contextType: row.contextType,
    contextKey: row.contextKey,
    documentTypeCode: row.documentTypeCode,
    mandatory: row.mandatory,
    version: row.version,
  };
}

function serializeDocument(row: DocumentRow): Record<string, unknown> {
  return {
    id: row.id,
    documentTypeCode: row.documentTypeCode,
    contextType: row.contextType,
    contextKey: row.contextKey,
    subjectId: row.subjectId,
    storageKey: row.storageKey,
    issuedAt: iso(row.issuedAt),
    expiresAt: iso(row.expiresAt),
    status: row.status,
    lastAlertAt: iso(row.lastAlertAt),
    version: row.version,
  };
}

function outboxCtx(ctx: { tenantId: string; actorId: string; correlationId: string }): OutboxCtx {
  return { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId };
}

export async function documentGovernanceRoutes(app: FastifyInstance): Promise<void> {
  // ── document types ────────────────────────────────────────────────────────
  app.post("/v1/admin/document-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ONLY);
    const body = parseOrThrow(typeBody, req.body);

    // Same uniqueness guard apply_uploads_0 runs in doc-f3-apply.ts (409
    // TYPE_EXISTS), lifted synchronously so a duplicate code is rejected here
    // instead of silently being accepted and dropped by the consumer.
    const clash = await scopedRead((tx) => repo.findTypeByCodeTx(tx, ctx.tenantId, body.code));
    if (clash) throw new HttpError(409, "TYPE_EXISTS", `document type '${body.code}' already exists`);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'uploads_op_0',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: __f3Id,
    });
    const created = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  app.get("/v1/admin/document-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DOC_ROLES);
    const q = parseOrThrow(typeListQuery, req.query);
    const { rows, total } = await repo.listTypes(ctx.tenantId, q.limit, (q.page - 1) * q.limit, q.status);
    return reply.send(listEnvelope(rows.map(serializeType), { page: q.page, pageSize: q.limit, total }));
  });

  app.patch("/v1/admin/document-types/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ONLY);
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(typePatchBody, req.body);
    const patchKeys = (["name", "maxSizeMb", "expiryRequired", "expiryWarnDays", "status"] as const)
      .filter((k) => body[k] !== undefined);
    if (patchKeys.length === 0) {
      throw new HttpError(400, "EMPTY_PATCH", "provide at least one field to update");
    }

    // Same existence + optimistic-lock guards apply_uploads_1 runs (404
    // NOT_FOUND, 409 VERSION_CONFLICT via assertVersionMatch), lifted
    // synchronously. The consumer's own CAS update is the backstop for the
    // residual TOCTOU race between this read and the async apply.
    const existing = await scopedRead((tx) => repo.findTypeTx(tx, ctx.tenantId, id));
    if (!existing) throw new HttpError(404, "NOT_FOUND", "document type not found");
    assertVersionMatch(existing.version, body.expectedVersion);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'uploads_op_1',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.send(singleEnvelope(result));
  });

  // ── requirements (which types are mandatory in a context) ─────────────────
  app.post("/v1/admin/document-requirements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ONLY);
    const body = parseOrThrow(requirementBody, req.body);

    // Same guards apply_uploads_2 runs (404 NOT_FOUND when the referenced
    // document type does not exist, 422 DOCUMENT_TYPE_RETIRED when it is
    // retired), lifted synchronously.
    const type = await scopedRead((tx) => repo.findTypeByCodeTx(tx, ctx.tenantId, body.documentTypeCode));
    if (!type) throw new HttpError(404, "NOT_FOUND", `document type '${body.documentTypeCode}' not found`);
    assertTypeActive(type.status);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'uploads_op_2',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: __f3Id,
    });
    const saved = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  app.get("/v1/admin/document-requirements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DOC_ROLES);
    const q = parseOrThrow(requirementListQuery, req.query);
    const { rows, total } = await repo.listRequirements(
      ctx.tenantId, q.limit, (q.page - 1) * q.limit, q.contextType, q.contextKey,
    );
    return reply.send(listEnvelope(rows.map(serializeRequirement), { page: q.page, pageSize: q.limit, total }));
  });

  // ── documents ─────────────────────────────────────────────────────────────
  app.post("/v1/admin/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DOC_ROLES);
    const body = parseOrThrow(documentBody, req.body);

    // Same guards apply_uploads_3 runs, in the same order, lifted
    // synchronously: 404 when the document type does not exist, then the
    // domain guards (422 DOCUMENT_TYPE_RETIRED / EXPIRY_REQUIRED /
    // INVALID_EXPIRY / EXTENSION_NOT_ALLOWED) against the fetched type row.
    const type = await scopedRead((tx) => repo.findTypeByCodeTx(tx, ctx.tenantId, body.documentTypeCode));
    if (!type) throw new HttpError(404, "NOT_FOUND", `document type '${body.documentTypeCode}' not found`);
    assertTypeActive(type.status);
    assertExpiryPresentWhenRequired(type.expiryRequired, body.expiresAt);
    assertExpiryAfterIssue(body.issuedAt, body.expiresAt);
    assertExtensionAllowed(body.storageKey, type.allowedExtensions);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'uploads_op_3',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: __f3Id,
    });
    const created = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  app.get("/v1/admin/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DOC_ROLES);
    const q = parseOrThrow(documentListQuery, req.query);
    const { rows, total } = await repo.listDocuments(ctx.tenantId, q.limit, (q.page - 1) * q.limit, {
      contextType: q.contextType, contextKey: q.contextKey, subjectId: q.subjectId, status: q.status,
    });
    return reply.send(listEnvelope(rows.map(serializeDocument), { page: q.page, pageSize: q.limit, total }));
  });

  // ── mandatory-document compliance for a context ───────────────────────────
  app.get("/v1/admin/documents/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DOC_ROLES);
    const q = parseOrThrow(complianceQuery, req.query);
    const requirements = await repo.requirementsForContext(ctx.tenantId, q.contextType, q.contextKey, q.limit);
    if (requirements.length === 0) {
      throw new HttpError(404, "NO_REQUIREMENTS", "no document requirements are defined for that context");
    }
    const held = await repo.documentsForContext(ctx.tenantId, q.contextType, q.contextKey, q.subjectId, q.limit);
    const types = await repo.typesByCodes(ctx.tenantId, requirements.map((r) => r.documentTypeCode));
    const warnDays: Record<string, number> = {};
    for (const t of types) warnDays[t.code] = t.expiryWarnDays;

    const report = evaluateCompliance(
      requirements.map((r) => ({ documentTypeCode: r.documentTypeCode, mandatory: r.mandatory })),
      held.map((d) => ({ documentTypeCode: d.documentTypeCode, status: d.status, expiresAt: d.expiresAt })),
      warnDays,
    );
    return reply.send(singleEnvelope({
      contextType: q.contextType,
      contextKey: q.contextKey,
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
      ...report,
    }));
  });

  /**
   * Expiry scan: re-classify documents whose expiry is inside the widest warning
   * window and publish an alert event for each status TRANSITION. Publishing —
   * not sending — is deliberate: notification-service consumes these events.
   *
   * No synchronous pre-check applies here: the scan has no existence,
   * uniqueness or state-transition precondition to gate on — it is an
   * idempotent classifier over whatever documents currently exist.
   */
  app.post("/v1/admin/documents/expiry-scan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ONLY);
    const body = parseOrThrow(scanBody, req.body ?? {});

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'uploads_op_4',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.send(singleEnvelope(result));
  });

  registerEnvelopeErrorHandler(app);
}
