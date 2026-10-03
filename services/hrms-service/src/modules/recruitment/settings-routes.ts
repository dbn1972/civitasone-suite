import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Per-tenant recruitment settings (migration 0180).
 *
 *   GET /v1/careers/organisation        PUBLIC  organisation identity for the careers pages
 *                                       (GAP-RECRUITMENT-CAREERS-HOME-02 / PORTAL-LOGIN-02)
 *   GET /v1/hrms/recruitment-settings   HR      the full settings (offer-workflow policy, purpose note)
 *   PUT /v1/hrms/recruitment-settings   admin   change them (queued; the consumer writes + audits)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { tenantStorage } from "@civitasone/db";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./settings-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];

/** https URL or an app-relative path; never `javascript:` / `data:` (the value is rendered into an <img src>). */
export const emblemUrlSchema = z.string().trim().max(2000).refine(
  (v) => /^https:\/\/[^\s]+$/i.test(v) || /^\/(?!\/)[^\s]*$/.test(v),
  "emblemUrl must be an https URL or an absolute path on this site",
);

export const updateSettingsBody = z.object({
  organisationName: z.string().trim().min(1).max(200).nullable().optional(),
  departmentName: z.string().trim().min(1).max(200).nullable().optional(),
  emblemUrl: emblemUrlSchema.nullable().optional(),
  offerWorkflowRequired: z.boolean().optional(),
  applicantPurposeNote: z.string().trim().min(1).max(2000).nullable().optional(),
}).strict().refine((b) => Object.keys(b).length > 0, "at least one setting is required");

export async function recruitmentSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/careers/organisation", { config: { public: true } }, async (req, reply) => {
    const tenantId = (req.query as { tenantId?: string })?.tenantId
      || (req.headers["x-tenant-id"] as string | undefined)
      || "";
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(400, "MISSING_TENANT", "tenantId is required");
    tenantStorage.enterWith({ tenantId });
    const s = await repo.getSettings(tenantId);
    // Only the public identity fields: the offer policy and purpose note are HR-internal.
    return reply.send({ data: { organisationName: s.organisationName, departmentName: s.departmentName, emblemUrl: s.emblemUrl } });
  });

  app.get("/v1/hrms/recruitment-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    return reply.send({ data: await repo.getSettings(ctx.tenantId) });
  });

  app.put("/v1/hrms/recruitment-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = updateSettingsBody.parse(req.body);
    await publishF3Write(ctx, "recruitment_settings_routes__0", randomUUID(), { body, params: {}, query: {} });
    return reply.code(202).send({ data: { ...(await repo.getSettings(ctx.tenantId)), ...body }, status: "accepted" });
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
