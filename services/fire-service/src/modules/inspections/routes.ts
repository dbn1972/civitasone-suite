import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as appRepo from "../applications/repo.js";
import { validateFindings } from "./domain.js";

const FIRE_ROLES = ["fire_user", "fire_admin", "super_admin"];
const OFFICER_ROLES = ["fire_admin", "fire_officer", "fire_inspector", "super_admin"];

const scheduleBody = z.object({
  applicationId: z.string().uuid(),
  inspectorId: z.string().uuid(),
  scheduledDate: z.string().date(),
});

const completeBody = z.object({
  recommendation: z.enum(["approve", "reject", "re_inspect"]),
  deficiencies: z.array(z.object({ description: z.string(), severity: z.string().optional() })).optional(),
});

const findingsBody = z.object({
  findings: z.array(z.object({ description: z.string(), compliant: z.boolean().optional() })),
});

const idParam = z.object({ id: z.string().uuid() });
const appIdParam = z.object({ applicationId: z.string().uuid() });

export async function inspectionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/fire/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = scheduleBody.parse(req.body);
    const application = await appRepo.findById(ctx.tenantId, body.applicationId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    // Previously checked existence only, not status — an inspection could be
    // scheduled against a draft/withdrawn/rejected application.
    //
    // NOTE: the applications state machine models "under_review" and
    // "inspection_scheduled" as the expected statuses at this point (see
    // applications/domain.ts's VALID_TRANSITIONS) — but no command anywhere
    // in this service ever moves an application INTO "under_review" (no
    // "start review" step exists), and scheduleInspection's own consumer
    // never touches fireApplicationsTable at all, so "inspection_scheduled"
    // is never set on the application either. Both are unreachable given the
    // current feature set (confirmed by reading every commands.ts/consumer.ts
    // in this service — only draft/submitted/withdrawn are ever actually
    // assigned). Requiring either would make inspection scheduling entirely
    // unreachable, so this gates on "submitted" — the actual state an
    // application is in once filed, and the achievable equivalent — rather
    // than the modeled-but-unreachable ones. Same judgment call as
    // PERMIT_ELIGIBLE_APPLICATION_STATUSES in the companion event-service PR
    // (#810) and LIFECYCLE_ACTIONABLE_STATUSES in the market-service PR
    // (#821); building a real review-workflow step is a separate feature,
    // flagged in the PR description, not done here.
    if (application.status !== "submitted") {
      throw new HttpError(422, "APPLICATION_NOT_SUBMITTED", `Application is in status '${application.status}', not eligible for inspection scheduling`);
    }
    return reply.code(202).send(await commands.scheduleInspection(ctx, body));
  });

  app.get("/v1/fire/inspections/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `fire:${ctx.tenantId}:inspection:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(ctx.tenantId, id));
    if (!row) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Inspection not found");
    return reply.send({ data: row });
  });

  app.get("/v1/fire/inspections/by-application/:applicationId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { applicationId } = appIdParam.parse(req.params);
    const rows = await repo.findByApplicationId(ctx.tenantId, applicationId);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/fire/inspections/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Inspection not found");
    if (existing.status !== "scheduled") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot complete inspection in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.completeInspection(ctx, id, body));
  });

  app.post("/v1/fire/inspections/:id/findings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = findingsBody.parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Inspection not found");
    // Was: no status check at all here (unlike /complete, which already had
    // one) — findings could be recorded on an already-completed inspection.
    // Now the same precondition as /complete, since recordFindings no longer
    // itself completes the inspection (see consumer.ts).
    if (existing.status !== "scheduled") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot record findings for inspection in status '${existing.status}'`);
    }
    if (!validateFindings(body.findings)) {
      throw new HttpError(400, "INVALID_FINDINGS", "Each finding requires a description");
    }
    return reply.code(202).send(await commands.recordFindings(ctx, id, body));
  });
}
