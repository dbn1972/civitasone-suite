/**
 * Interview calendar (checklist R-RA-0140 / 0141).
 *
 *   GET  /v1/hrms/interviews/:id/calendar.ics   download an iCalendar invite (local, real)
 *   POST /v1/hrms/interviews/:id/calendar-sync  push to Google/Outlook (external seam)
 *
 * The .ics download is a genuine RFC-5545 artefact built locally — always
 * available, no third party. Push-sync to an external provider is behind the
 * FEATURE_CALENDAR_SYNC_ENABLED flag + a typed adapter; until an adapter is
 * wired the sync endpoint honestly returns 501 and never fabricates a sync.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { buildIcs, calendarSyncEnabled, CALENDAR_PROVIDERS } from "./interview-calendar.js";
import * as ivRepo from "./interview-comms-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function interviewCalendarRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/interviews/:id/calendar.ics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const iv = await ivRepo.findInterview(ctx.tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");

    const locationParts = [iv.location, iv.meetingLink].filter(Boolean) as string[];
    const ics = buildIcs({
      uid: `interview-${iv.id}@civitasone`,
      title: `Interview — ${iv.roundType} (round ${iv.roundNumber})`,
      description: iv.meetingLink ? `Join: ${iv.meetingLink}` : undefined,
      location: locationParts.length ? locationParts.join(" | ") : undefined,
      date: iv.scheduledDate as unknown as string,
      time: iv.scheduledTime,
      durationMinutes: iv.durationMinutes,
    });
    return reply
      .header("content-type", "text/calendar; charset=utf-8")
      .header("content-disposition", `attachment; filename="interview_${iv.id}.ics"`)
      .send(ics);
  });

  app.post("/v1/hrms/interviews/:id/calendar-sync", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ provider: z.enum(CALENDAR_PROVIDERS) }).parse(req.body ?? {});
    const iv = await ivRepo.findInterview(ctx.tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");

    // External push-sync is not wired. Do NOT fake it — direct the caller to the
    // local .ics, which is a real, importable invite.
    if (!calendarSyncEnabled(process.env)) {
      throw new HttpError(501, "CALENDAR_SYNC_NOT_ENABLED", `push-sync to ${body.provider} is not available; download the .ics invite from /v1/hrms/interviews/${id}/calendar.ics`);
    }
    // Flag on but no provider adapter is implemented — still never fabricate.
    throw new HttpError(501, "CALENDAR_ADAPTER_NOT_IMPLEMENTED", `no ${body.provider} calendar adapter is implemented`);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
