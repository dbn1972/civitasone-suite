import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Candidate profile — reservation attributes (R-RA-0082) + references and
 * prior-relationship declarations (R-RA-0083).
 *
 *   PUT /v1/hrms/candidates/:id/reservation-attributes
 *   PUT /v1/hrms/candidates/:id/references
 *   PUT /v1/hrms/candidates/:id/relationship-declaration
 *   GET /v1/hrms/candidates/:id/references
 *
 * All edits are draft-only (a submitted profile is locked, mirroring the rest of
 * the candidate module). Reserved-category / disability / ex-serviceman claims
 * require supporting documents; at least two distinct references are required;
 * a declared prior relationship must name the person(s) and nature.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  DISABILITY_TYPES, validateReservationAttributes, validateReferences, validateRelationshipDeclaration,
  type Reference, type RelationshipDeclaration,
} from "./reference-domain.js";
import * as candidateRepo from "./candidate-repo.js";
import * as repo from "./reference-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function candidateReferenceRoutes(app: FastifyInstance): Promise<void> {
  // ---- reservation attributes (R-RA-0082) ------------------------------
  app.put("/v1/hrms/candidates/:id/reservation-attributes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      category: z.string().max(8).optional(),
      subCategory: z.string().max(32).optional(),
      disability: z.boolean().default(false),
      disabilityType: z.enum(DISABILITY_TYPES).optional(),
      disabilityPercentage: z.coerce.number().int().min(1).max(100).optional(),
      exServiceman: z.boolean().default(false),
      freedomFighterDependent: z.boolean().default(false),
      reservationDocs: z.array(z.string().max(512)).max(20).optional(),
    }).parse(req.body);
    const c = await mustDraft(ctx.tenantId, id);

    const errors = validateReservationAttributes({
      category: body.category ?? null, disability: body.disability, disabilityType: body.disabilityType ?? null,
      disabilityPercentage: body.disabilityPercentage ?? null, exServiceman: body.exServiceman,
      freedomFighterDependent: body.freedomFighterDependent, reservationDocs: body.reservationDocs ?? [],
    });
    if (errors.length > 0) throw new HttpError(422, "INVALID_RESERVATION", errors.join("; "));

    // Persist a NORMALISED (uppercase) category so the reservation-shortlist module
    // (#257) sees a canonical value and never mis-buckets a lowercase "obc".
    const category = body.category ? body.category.trim().toUpperCase() : null;
    await publishF3Write(ctx, "recruitment_reference_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    void c;
    return reply.send({ id, updated: true });
  });

  // ---- references (R-RA-0083) ------------------------------------------
  app.put("/v1/hrms/candidates/:id/references", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      references: z.array(z.object({
        name: z.string().min(1).max(200),
        relationship: z.string().min(1).max(120),
        organisation: z.string().max(200).optional(),
        designation: z.string().max(120).optional(),
        email: z.string().max(200).optional(),
        phone: z.string().max(20).optional(),
        yearsKnown: z.coerce.number().int().min(0).max(80).optional(),
      })).min(1).max(10),
    }).parse(req.body);
    const c = await mustDraft(ctx.tenantId, id);

    const errors = validateReferences(body.references as Reference[], { email: c.email, phone: c.mobile });
    if (errors.length > 0) throw new HttpError(422, "INVALID_REFERENCES", errors.join("; "));

    await publishF3Write(ctx, "recruitment_reference_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, references: body.references.length });
  });

  // ---- prior-relationship declaration (R-RA-0083) ----------------------
  app.put("/v1/hrms/candidates/:id/relationship-declaration", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      hasPriorRelationship: z.boolean(),
      relations: z.array(z.object({ personName: z.string().min(1).max(200), nature: z.string().min(1).max(200) })).max(50).optional(),
    }).parse(req.body);
    await mustDraft(ctx.tenantId, id);

    const errors = validateRelationshipDeclaration(body as RelationshipDeclaration);
    if (errors.length > 0) throw new HttpError(422, "INVALID_DECLARATION", errors.join("; "));

    await publishF3Write(ctx, "recruitment_reference_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, hasPriorRelationship: body.hasPriorRelationship });
  });

  app.get("/v1/hrms/candidates/:id/references", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    await mustCandidate(ctx.tenantId, id);
    return reply.send({ id, data: await repo.listReferences(ctx.tenantId, id) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustCandidate(tenantId: string, id: string) {
    const c = await candidateRepo.findCandidate(tenantId, id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
    return c;
  }
  async function mustDraft(tenantId: string, id: string) {
    const c = await mustCandidate(tenantId, id);
    if (c.status !== "draft") throw new HttpError(409, "LOCKED", "the profile is locked after submission and can only be edited while a draft");
    return c;
  }
}
