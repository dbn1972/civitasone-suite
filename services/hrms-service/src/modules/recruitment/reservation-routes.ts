import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Screening & shortlisting — reservation roster + category/location shortlist
 * (R-RA-0116).
 *
 *   PUT  /v1/hrms/job-openings/:id/reservation-roster           set the roster (draft)
 *   POST /v1/hrms/job-openings/:id/reservation-roster/approve   approve (senior, SoD)
 *   GET  /v1/hrms/job-openings/:id/reservation-roster           get the roster
 *   POST /v1/hrms/job-openings/:id/reservation-shortlist        compute the category/location shortlist
 *
 * The roster (UR/SC/ST/OBC/EWS vacancies, optionally per location) is stored per
 * job opening and approved by an independent senior user. The shortlist applies
 * the meritorious-reserved rule against the (approved) roster to a supplied pool
 * of screened-eligible candidates; the frozen list is recorded via the selection
 * list (#256).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  RESERVATION_CATEGORIES, validateRoster, validateLocationRosters, unmappedCategories,
  allocateShortlist, allocateByLocation, type Roster, type Candidate,
} from "./reservation-domain.js";
import * as repo from "./reservation-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const RESERVATION_ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const rosterShape = z.record(z.enum(RESERVATION_CATEGORIES), z.coerce.number().int().min(0));

export async function reservationRoutes(app: FastifyInstance): Promise<void> {
  // ---- set the roster (draft) ------------------------------------------
  app.put("/v1/hrms/job-openings/:id/reservation-roster", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: jobOpeningId } = idParam.parse(req.params);
    const body = z.object({
      totalVacancies: z.coerce.number().int().min(1),
      categoryVacancies: rosterShape,
      locationRosters: z.record(z.string().min(1).max(120), rosterShape).optional(),
    }).parse(req.body);

    const errors = validateRoster(body.categoryVacancies as Roster, body.totalVacancies);
    // Location rosters must reconcile with the approved category vacancies — the
    // per-category sum across locations must equal that category's total, so
    // location-mode shortlisting can never exceed the sanctioned profile.
    if (body.locationRosters && Object.keys(body.locationRosters).length > 0) {
      errors.push(...validateLocationRosters(body.locationRosters as Record<string, Roster>, body.categoryVacancies as Roster));
    }
    if (errors.length > 0) throw new HttpError(422, "INVALID_ROSTER", errors.join("; "));

    const existing = await repo.findByJob(ctx.tenantId, jobOpeningId);
    if (existing && existing.status === "approved") throw new HttpError(409, "APPROVED", "an approved roster cannot be changed");

    try {
      await publishF3Write(ctx, "recruitment_reservation_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (e) {
      // Two concurrent first-time sets on the same new job collide on UNIQUE(tenant,job).
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "ROSTER_EXISTS", "a roster for this job opening was created concurrently; reload and retry");
      throw e;
    }
    return reply.send({ jobOpeningId, status: "draft", totalVacancies: body.totalVacancies });
  });

  // ---- approve (senior, SoD) -------------------------------------------
  app.post("/v1/hrms/job-openings/:id/reservation-roster/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RESERVATION_ADMIN_ROLES);
    const { id: jobOpeningId } = idParam.parse(req.params);
    const roster = await mustRoster(ctx.tenantId, jobOpeningId);
    if (roster.status === "approved") throw new HttpError(409, "ALREADY_APPROVED", "the roster is already approved");
    if (roster.createdBy === ctx.actorId) throw new HttpError(403, "SOD_VIOLATION", "the roster creator cannot approve it; an independent authorised user must approve");
    await publishF3Write(ctx, "recruitment_reservation_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ jobOpeningId, status: "approved" });
  });

  app.get("/v1/hrms/job-openings/:id/reservation-roster", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: jobOpeningId } = idParam.parse(req.params);
    return reply.send(await mustRoster(ctx.tenantId, jobOpeningId));
  });

  // ---- compute the shortlist (R-RA-0116) -------------------------------
  app.post("/v1/hrms/job-openings/:id/reservation-shortlist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: jobOpeningId } = idParam.parse(req.params);
    const body = z.object({
      byLocation: z.boolean().optional(),
      candidates: z.array(z.object({
        applicationId: z.string().uuid(),
        category: z.string().min(1).max(24),
        score: z.coerce.number(),
        location: z.string().max(120).optional(),
      })).min(1).max(20000),
    }).parse(req.body);
    const roster = await mustRoster(ctx.tenantId, jobOpeningId);
    if (roster.status !== "approved") throw new HttpError(409, "ROSTER_NOT_APPROVED", "the reservation roster must be approved before shortlisting");

    const candidates: Candidate[] = body.candidates.map((c) => ({ applicationId: c.applicationId, category: c.category, score: c.score, location: c.location ?? null }));

    // FAIL CLOSED: an unrecognised category must never be silently treated as UR
    // (that would strip a reservation entitlement). HR must map it first.
    const unmapped = unmappedCategories(candidates);
    if (unmapped.length > 0) {
      const sample = [...new Set(unmapped.map((u) => u.category))].slice(0, 8).join(", ");
      throw new HttpError(422, "UNMAPPED_CATEGORY", `${unmapped.length} candidate(s) have an unrecognised category (${sample}); map them before shortlisting`);
    }

    if (body.byLocation) {
      const locRosters = roster.locationRosters as Record<string, Roster>;
      if (!locRosters || Object.keys(locRosters).length === 0) throw new HttpError(409, "NO_LOCATION_ROSTERS", "the roster has no per-location breakdown");
      return reply.send({ jobOpeningId, mode: "location", ...allocateByLocation(candidates, locRosters) });
    }
    return reply.send({ jobOpeningId, mode: "category", ...allocateShortlist(candidates, roster.categoryVacancies as Roster) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustRoster(tenantId: string, jobOpeningId: string) {
    const r = await repo.findByJob(tenantId, jobOpeningId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "reservation roster not found for this job opening");
    return r;
  }
}
