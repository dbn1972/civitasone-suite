/**
 * findings module — HTTP routes (Fastify plugin `registerFindingsRoutes`, 6 endpoints).
 *
 * Follows the suite CQRS + envelope conventions:
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish → 202
 *   • READS  — cache-first `repo.*` lookups
 *   • DELETE — soft-delete with deletion protection (Req 9.8)
 *
 * RBAC (design.md § API Routes — Findings Module):
 *   - inspector — create findings, verify resolved, soft-delete (pre-review)
 *   - reviewing_officer — read findings, create compliance notices
 *   - inspector + reviewing_officer — read operations
 *
 * Endpoints (6):
 *   POST   /v1/inspection/findings                       — create finding
 *   GET    /v1/inspection/findings/:id                   — get finding by ID
 *   GET    /v1/inspection/findings                       — list findings (paginated, filterable)
 *   POST   /v1/inspection/findings/:id/compliance-notice — create compliance notice
 *   POST   /v1/inspection/findings/:id/verify            — verify finding resolved
 *   DELETE /v1/inspection/findings/:id                   — soft-delete (pre-review only)
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishFindingCreate,
  publishComplianceNoticeCreate,
  publishFindingVerifyResolved,
} from "./commands.js";
import {
  findFindingById,
  findFindings,
  softDeleteFinding,
} from "./repo.js";
import { findInspectionById } from "../execution/repo.js";
import { assertDeletionAllowed, DomainError } from "./domain.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";

// ─── RBAC role groups ────────────────────────────────────────────────────────

/** Write access: inspectors create findings and verify resolution. */
const INSPECTOR_ROLES = ["inspector", "inspection_admin", "tenant_admin", "super_admin"];

/** Compliance notice: reviewing officers issue compliance notices. */
const NOTICE_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Read access: inspectors and reviewing officers. */
const READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** Reusable UUID path param schema. */
const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

/** POST /v1/inspection/findings — create finding (Req 9.1, 9.2). */
const createFindingSchema = z.object({
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
  questionId: z.string().optional(),
  provisionId: z.string().uuid("provisionId must be a valid UUID"),
  description: z.string().min(1, "description is required"),
  evidenceIds: z.array(z.string().uuid()).optional(),
});

/** POST /findings/:id/compliance-notice — create compliance notice (Req 9.4). */
const createComplianceNoticeSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD format"),
  requiredAction: z.string().min(1, "requiredAction is required"),
  responsibleParty: z.string().min(1, "responsibleParty is required"),
});

/** POST /findings/:id/verify — verify finding resolved (Req 9.6). */
const verifyResolvedSchema = z.object({
  verificationEvidenceIds: z.array(z.string().uuid()).optional(),
  verifierNotes: z.string().max(2000).optional(),
});

/** GET /findings — list with pagination and filters. */
const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  inspectionId: z.string().uuid().optional(),
  state: z.string().optional(),
  severity: z.string().optional(),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerFindingsRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/findings (Req 9.1, 9.2, 9.3) ──
  app.post("/v1/inspection/findings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSPECTOR_ROLES);
    const body = createFindingSchema.parse(req.body);
    const result = await publishFindingCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/findings/:id (Req 9.1) ──
  app.get("/v1/inspection/findings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const finding = await findFindingById(ctx.tenantId, id);
    if (!finding) throw new HttpError(404, "NOT_FOUND", "finding not found");
    return reply.send({ data: finding });
  });

  // ── GET /v1/inspection/findings (Req 9.1) ──
  app.get("/v1/inspection/findings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findFindings(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
      {
        inspectionId: query.inspectionId,
        state: query.state,
        severity: query.severity,
      },
    );
    return reply.send(result);
  });

  // ── POST /v1/inspection/findings/:id/compliance-notice (Req 9.4) ──
  app.post("/v1/inspection/findings/:id/compliance-notice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, NOTICE_ROLES);
    const { id } = idParam.parse(req.params);

    // Verify finding exists before publishing command
    const finding = await findFindingById(ctx.tenantId, id);
    if (!finding) throw new HttpError(404, "NOT_FOUND", "finding not found");

    const body = createComplianceNoticeSchema.parse(req.body);
    const result = await publishComplianceNoticeCreate(
      { findingId: id, ...body },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/findings/:id/verify (Req 9.6) ──
  app.post("/v1/inspection/findings/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSPECTOR_ROLES);
    const { id } = idParam.parse(req.params);

    // Verify finding exists before publishing command
    const finding = await findFindingById(ctx.tenantId, id);
    if (!finding) throw new HttpError(404, "NOT_FOUND", "finding not found");

    const body = verifyResolvedSchema.parse(req.body);
    const result = await publishFindingVerifyResolved(
      { findingId: id, ...body },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // ── DELETE /v1/inspection/findings/:id (Req 9.8) ──
  // Soft-delete: only permitted if parent inspection is NOT in under_review or finalized
  app.delete("/v1/inspection/findings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSPECTOR_ROLES);
    const { id } = idParam.parse(req.params);

    // 1. Load finding
    const finding = await findFindingById(ctx.tenantId, id);
    if (!finding) throw new HttpError(404, "NOT_FOUND", "finding not found");

    // 2. Load parent inspection to check deletion protection (Req 9.8)
    const inspection = await findInspectionById(ctx.tenantId, finding.inspectionId);
    if (!inspection) {
      throw new HttpError(404, "NOT_FOUND", "parent inspection not found");
    }

    // 3. Assert deletion is allowed based on inspection state
    try {
      assertDeletionAllowed(inspection.state);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new HttpError(422, "DELETION_PROTECTED", err.message);
      }
      throw err;
    }

    // 4. Soft-delete directly (synchronous for DELETE — immediate consistency needed)
    await db.transaction(async (tx) => {
      await softDeleteFinding(tx, id, ctx.tenantId, ctx.actorId);

      // Audit event
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          action: "finding.soft_deleted",
          resourceType: "finding",
          resourceId: id,
          details: {
            findingNumber: finding.findingNumber,
            inspectionId: finding.inspectionId,
            inspectionState: inspection.state,
          },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    try {
      await cache.invalidate(cache.makeKey(ctx.tenantId, "finding", id));
    } catch {
      // best-effort — logged by cache library
    }

    return reply.code(204).send();
  });
}
