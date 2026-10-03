import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsInterviews, hrmsInterviewScores } from "./schema.js";
import * as repo from "./repo.js";
import { buildScorecards, panelMemberIds, type ScorecardInterview, type ScorecardScore } from "./application-scorecards.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
/** An application rarely has more than a handful of rounds; bound it regardless. */
const MAX_INTERVIEWS = 50;

/**
 * GET /v1/hrms/applications/:id/scorecards -- every interview of the application with its scorecard, under the
 * same blind-scoring visibility as the per-interview score routes (see application-scorecards.ts).
 */
export async function applicationScorecardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/applications/:id/scorecards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const application = await repo.findApplicationById(id, ctx.tenantId);
    if (!application) throw new HttpError(404, "NOT_FOUND", "Application not found");

    const interviews = (await scopedRead((tx) => tx.select().from(hrmsInterviews)
      .where(and(eq(hrmsInterviews.tenantId, ctx.tenantId), eq(hrmsInterviews.applicationId, id)))
      .orderBy(asc(hrmsInterviews.roundNumber), asc(hrmsInterviews.scheduledDate), asc(hrmsInterviews.id))
      .limit(MAX_INTERVIEWS))) as unknown as ScorecardInterview[];

    const ids = interviews.map((i) => i.id);
    const scores: ScorecardScore[] = ids.length === 0 ? [] : (await scopedRead((tx) => tx.select().from(hrmsInterviewScores)
      .where(and(eq(hrmsInterviewScores.tenantId, ctx.tenantId), inArray(hrmsInterviewScores.interviewId, ids)))
      .orderBy(asc(hrmsInterviewScores.createdAt), asc(hrmsInterviewScores.id)))) as unknown as ScorecardScore[];

    // Interviewer ids are identity-user ids: resolve them to employee names in ONE tenant-scoped query.
    const interviewerIds = [...new Set([...scores.map((s) => s.interviewerId), ...interviews.flatMap((i) => [...panelMemberIds(i.panelMembers)])])];
    const nameRows = interviewerIds.length === 0 ? [] : await scopedRead((tx) => tx
      .select({ userRef: hrmsEmployees.userRef, fullName: hrmsEmployees.fullName }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.userRef, interviewerIds))));
    const names = new Map<string, string>();
    for (const r of nameRows) if (r.userRef) names.set(r.userRef, r.fullName);

    const data = buildScorecards(interviews, scores, { actorId: ctx.actorId, isHr: true }, names);
    return reply.send({ data });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
