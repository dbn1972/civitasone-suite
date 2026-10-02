import { eq, and, desc } from "drizzle-orm";
/**
 * Candidate self-service portal routes — require a valid cand_token Bearer token.
 *
 *   GET /v1/careers/portal/applications        list the candidate's own applications
 *   GET /v1/careers/portal/applications/:id    single application with stage detail
 *
 * Authentication: Authorization: Bearer <cand_token> (signed by CANDIDATE_JWT_SECRET).
 * The token is issued by /v1/careers/auth/otp-verify and contains candidateId,
 * tenantId, email, and exp.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsApplications, hrmsJobOpenings } from "./schema.js";
import { verifyCandToken } from "./candidate-public-auth-routes.js";
import { buildStageTimeline, portalOutcome } from "./candidate-portal-timeline.js";

function resolveCandidateClaims(req: { headers: Record<string, string | string[] | undefined> }): { candidateId: string; tenantId: string; email: string } {
  const authHeader = req.headers["authorization"];
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw?.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHORIZED", "missing or invalid cand_token");
  const token = raw.slice(7);
  const claims = verifyCandToken(token);
  if (!claims) throw new HttpError(401, "UNAUTHORIZED", "cand_token is invalid or expired");
  return claims;
}

export async function candidatePublicPortalRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/careers/portal/applications
  // Returns all active applications for the authenticated candidate (matched by email).
  app.get("/v1/careers/portal/applications", { config: { public: true } }, async (req, reply) => {
    const claims = resolveCandidateClaims(req as any);
    const { tenantId, email } = claims;

    const rows = await scopedRead((tx) =>
      tx.select({
        id: hrmsApplications.id,
        applicationNo: hrmsApplications.applicationNo,
        jobOpeningId: hrmsApplications.jobOpeningId,
        stage: hrmsApplications.stage,
        status: hrmsApplications.status,
        appliedAt: hrmsApplications.appliedAt,
      })
        .from(hrmsApplications)
        .where(and(
          eq(hrmsApplications.tenantId, tenantId),
          eq(hrmsApplications.email, email),
        ))
        .orderBy(desc(hrmsApplications.appliedAt))
        .limit(50)
    );

    // Fetch job titles for each application.
    const jobIds = [...new Set(rows.map((r) => r.jobOpeningId))];
    const titles = jobIds.length > 0
      ? await scopedRead((tx) =>
        tx.select({ id: hrmsJobOpenings.id, title: hrmsJobOpenings.title, location: hrmsJobOpenings.location, refNo: hrmsJobOpenings.refNo })
          .from(hrmsJobOpenings)
          .where(eq(hrmsJobOpenings.tenantId, tenantId))
        )
      : [];

    const titleMap = new Map(titles.map((t) => [t.id, t]));

    const data = rows.map((r) => {
      const job = titleMap.get(r.jobOpeningId);
      return {
        id: r.id,
        applicationNo: r.applicationNo,
        jobOpeningId: r.jobOpeningId,
        jobTitle: job?.title ?? "Unknown Position",
        jobLocation: job?.location ?? null,
        jobRefNo: job?.refNo ?? null,
        stage: r.stage,
        status: r.status,
        appliedAt: r.appliedAt,
      };
    });

    return reply.send({ data });
  });

  // GET /v1/careers/portal/applications/:id
  // Single application detail including job info. Only accessible to the applicant themselves.
  app.get("/v1/careers/portal/applications/:id", { config: { public: true } }, async (req, reply) => {
    const claims = resolveCandidateClaims(req as any);
    const { tenantId, email } = claims;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await scopedRead((tx) =>
      tx.select()
        .from(hrmsApplications)
        .where(and(
          eq(hrmsApplications.id, id),
          eq(hrmsApplications.tenantId, tenantId),
          eq(hrmsApplications.email, email),
        ))
        .limit(1)
    );
    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "application not found");
    const app_ = rows[0]!;

    const jobs = await scopedRead((tx) =>
      tx.select({ id: hrmsJobOpenings.id, title: hrmsJobOpenings.title, refNo: hrmsJobOpenings.refNo, location: hrmsJobOpenings.location, description: hrmsJobOpenings.description, payRange: hrmsJobOpenings.payRange, vacancies: hrmsJobOpenings.vacancies, closesAt: hrmsJobOpenings.closesAt })
        .from(hrmsJobOpenings)
        .where(and(eq(hrmsJobOpenings.id, app_.jobOpeningId), eq(hrmsJobOpenings.tenantId, tenantId)))
        .limit(1)
    );
    const job = jobs[0] ?? null;

    // Build a human-readable stage timeline.
    const stages = buildStageTimeline({ stage: app_.stage, appliedAt: app_.appliedAt });

    return reply.send({
      id: app_.id,
      applicationNo: app_.applicationNo,
      stage: app_.stage,
      status: app_.status,
      appliedAt: app_.appliedAt,
      // GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-01: screeningRemarks is an
      // internal HR note and must never reach the candidate.
      outcome: portalOutcome(app_.stage),
      job: job ? {
        id: job.id,
        title: job.title,
        refNo: job.refNo,
        location: job.location,
        description: job.description,
        payRange: job.payRange,
        vacancies: job.vacancies,
        closesAt: job.closesAt,
      } : null,
      timeline: stages,
    });
  });

  app.setErrorHandler(errHandler);
}

function errHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code((err as { status: number }).status).send({ code: (err as { code: string }).code, message: err.message, correlationId });
    return;
  }
  req.log.error({ err }, "candidate portal error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
}
