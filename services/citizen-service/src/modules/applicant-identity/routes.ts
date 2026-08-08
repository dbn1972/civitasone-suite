import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { PROFILE_ATTRIBUTE_REGISTRY, APPLICANT_TYPES, attributesForTypes, isApplicantType } from "./domain.js";

const DESIGNER_ROLES = ["citizen_officer", "citizen_admin", "super_admin", "service_designer"];

/**
 * FN-23 — read-only profile attribute registry for the Designer picker.
 * Mutations of allowed types live on catalogue service definitions.
 */
export async function applicantIdentityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/citizen/applicant-identity/types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...DESIGNER_ROLES, "citizen"]);
    return reply.send({
      data: APPLICANT_TYPES.map((id) => ({
        id,
        anonymousGrievanceOnly: id === "anonymous",
      })),
    });
  });

  app.get("/v1/citizen/applicant-identity/profile-attributes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...DESIGNER_ROLES, "citizen"]);
    const q = req.query as { applicantTypes?: string };
    const filter = typeof q.applicantTypes === "string" && q.applicantTypes.length > 0
      ? q.applicantTypes.split(",").map((s) => s.trim()).filter(isApplicantType)
      : null;
    const data = filter && filter.length > 0
      ? attributesForTypes(filter)
      : [...PROFILE_ATTRIBUTE_REGISTRY];
    return reply.send({ data });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
