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
 * `admin.document.expiring` / `admin.document.expired` on the transactional
 * outbox (contracts documented in src/topics.ts). notification-service owns the
 * channel and template and consumes them; admin-service does not send anything
 * itself and this sprint does not touch notification-service.
 *
 * The scan is an idempotent classifier: a document already in the right status
 * is left alone and no duplicate alert is emitted, so it is safe to run on a
 * schedule or by hand.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db } from "../../shared/db.js";
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
   * `offset: true` is required: zod's bare `.datetime()` accepts only a `Z`
   * suffix, so a client submitting `2027-03-31T00:00:00+05:30` — a perfectly
   * unambiguous instant, and the natural form for an IST caller — was refused
   * with a 400. Both columns are `timestamptz` and every comparison in
   * doc-domain.ts goes through `new Date`, so an offset stores and classifies as
   * exactly the same instant. `Z` remains valid.
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

    const created = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const clash = await repo.findTypeByCodeTx(w, ctx.tenantId, body.code);
      if (clash) throw new HttpError(409, "TYPE_EXISTS", `document type '${body.code}' already exists`);
      const row = await repo.insertType(w, {
        tenantId: ctx.tenantId,
        code: body.code,
        name: body.name,
        category: body.category,
        allowedExtensions: body.allowedExtensions,
        maxSizeMb: body.maxSizeMb,
        expiryRequired: body.expiryRequired,
        expiryWarnDays: body.expiryWarnDays,
        status: "active",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await auditEvent(tx, outboxCtx(ctx), "document_type.created", RESOURCE_TYPE, row.id, { code: row.code });
      return row;
    });
    return reply.code(201).send(singleEnvelope(serializeType(created)));
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

    const result = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const row = await repo.findTypeTx(w, ctx.tenantId, id);
      if (!row) throw new HttpError(404, "NOT_FOUND", "document type not found");
      assertVersionMatch(row.version, body.expectedVersion);
      const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
      for (const key of patchKeys) patch[key] = body[key];
      const moved = await repo.updateType(w, ctx.tenantId, id, body.expectedVersion, patch);
      if (!moved) throw new HttpError(409, "VERSION_CONFLICT", "document type was modified concurrently; re-read and retry");
      await auditEvent(tx, outboxCtx(ctx), "document_type.updated", RESOURCE_TYPE, id);
      return { id, version: body.expectedVersion + 1 };
    });
    return reply.send(singleEnvelope(result));
  });

  // ── requirements (which types are mandatory in a context) ─────────────────
  app.post("/v1/admin/document-requirements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ONLY);
    const body = parseOrThrow(requirementBody, req.body);

    const saved = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const type = await repo.findTypeByCodeTx(w, ctx.tenantId, body.documentTypeCode);
      if (!type) throw new HttpError(404, "NOT_FOUND", `document type '${body.documentTypeCode}' not found`);
      assertTypeActive(type.status);
      const row = await repo.upsertRequirement(w, {
        tenantId: ctx.tenantId,
        contextType: body.contextType,
        contextKey: body.contextKey,
        documentTypeCode: body.documentTypeCode,
        mandatory: body.mandatory,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await auditEvent(tx, outboxCtx(ctx), "document_requirement.set", RESOURCE_TYPE, row.id, {
        contextType: row.contextType, documentTypeCode: row.documentTypeCode, mandatory: row.mandatory,
      });
      return row;
    });
    return reply.code(201).send(singleEnvelope(serializeRequirement(saved)));
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

    const created = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const type = await repo.findTypeByCodeTx(w, ctx.tenantId, body.documentTypeCode);
      if (!type) throw new HttpError(404, "NOT_FOUND", `document type '${body.documentTypeCode}' not found`);
      assertTypeActive(type.status);
      assertExpiryPresentWhenRequired(type.expiryRequired, body.expiresAt);
      assertExpiryAfterIssue(body.issuedAt, body.expiresAt);
      assertExtensionAllowed(body.storageKey, type.allowedExtensions);

      const expiresAt = body.expiresAt !== undefined ? new Date(body.expiresAt) : null;
      const status = classifyExpiry("active", expiresAt, type.expiryWarnDays);
      const row = await repo.insertDocument(w, {
        tenantId: ctx.tenantId,
        documentTypeCode: body.documentTypeCode,
        contextType: body.contextType,
        contextKey: body.contextKey,
        subjectId: body.subjectId,
        storageKey: body.storageKey,
        issuedAt: body.issuedAt !== undefined ? new Date(body.issuedAt) : null,
        expiresAt,
        status,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      // Identifiers only — never the document contents or a subject's name.
      await auditEvent(tx, outboxCtx(ctx), "document.registered", RESOURCE_DOC, row.id, {
        documentTypeCode: row.documentTypeCode, contextType: row.contextType, status: row.status,
      });
      return row;
    });
    return reply.code(201).send(singleEnvelope(serializeDocument(created)));
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
   */
  app.post("/v1/admin/documents/expiry-scan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ONLY);
    const body = parseOrThrow(scanBody, req.body ?? {});

    const result = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const now = new Date();
      // Widest configured warning window bounds the scan horizon.
      const { rows: typeRows } = await repo.listTypes(ctx.tenantId, 200, 0, "active");
      const widestWarnDays = typeRows.reduce((m, t) => (t.expiryWarnDays > m ? t.expiryWarnDays : m), 30);
      const horizon = new Date(now.getTime() + widestWarnDays * 24 * 60 * 60_000);
      const warnDays: Record<string, number> = {};
      for (const t of typeRows) warnDays[t.code] = t.expiryWarnDays;

      const candidates = await repo.expiryCandidatesTx(w, ctx.tenantId, horizon, body.limit);
      let expiring = 0;
      let expired = 0;
      let unchanged = 0;
      /**
       * A document can also move BACKWARDS — `expiring` → `active` — when an
       * administrator narrows a type's `expiryWarnDays` after the document was
       * already flagged. That is a real state change but NOT an alert, so it is
       * counted separately: without its own counter the row was re-classified
       * while `scanned` disagreed with expiring+expired+unchanged, and the
       * caller had no way to see that anything happened.
       */
      let recovered = 0;

      for (const doc of candidates) {
        const next = classifyExpiry(doc.status, doc.expiresAt, warnDays[doc.documentTypeCode] ?? 30, now);
        if (next === doc.status) {
          unchanged++;
          continue;
        }
        // `lastAlertAt` records when an alert was SENT. Only stamp it on a
        // transition that actually publishes one, otherwise a recovery would
        // leave behind a timestamp for an alert that never went out.
        const alerting = next === "expiring" || next === "expired";
        const moved = await repo.updateDocument(w, ctx.tenantId, doc.id, doc.version, {
          status: next, ...(alerting ? { lastAlertAt: now } : {}), updatedBy: ctx.actorId,
        });
        if (!moved) {
          // Concurrently modified: leave it for the next scan rather than
          // clobbering someone else's write.
          unchanged++;
          continue;
        }
        const base = {
          documentId: doc.id,
          documentTypeCode: doc.documentTypeCode,
          contextType: doc.contextType,
          contextKey: doc.contextKey,
          subjectId: doc.subjectId,
          expiresAt: iso(doc.expiresAt) ?? "",
        };
        if (next === "expiring") {
          expiring++;
          await domainEvent(tx, outboxCtx(ctx), EVENTS.documentExpiring, {
            ...base, daysRemaining: doc.expiresAt !== null ? daysUntil(doc.expiresAt, now) : 0,
          });
        } else if (next === "expired") {
          expired++;
          await domainEvent(tx, outboxCtx(ctx), EVENTS.documentExpired, base);
        } else {
          recovered++;
        }
      }

      await auditEvent(tx, outboxCtx(ctx), "document.expiry_scan", RESOURCE_DOC, ctx.tenantId, {
        scanned: candidates.length, expiring, expired, unchanged, recovered,
      });
      return {
        scanned: candidates.length, expiring, expired, unchanged, recovered,
        horizon: horizon.toISOString(),
      };
    });
    return reply.send(singleEnvelope(result));
  });

  registerEnvelopeErrorHandler(app);
}
