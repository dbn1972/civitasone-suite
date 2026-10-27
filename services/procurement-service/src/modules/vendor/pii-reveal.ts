/**
 * GAP-PROCUREMENT-VENDORS-02 -- audited PII reveal for the vendor master (DPDP).
 *
 *   POST /v1/procurement/pii/reveal  { resourceType: "vendor", resourceId, field, reason } -> { data: { value } }
 *
 * Same request/response contract as crm `POST /v1/crm/pii/reveal` and hrms
 * `POST /v1/hrms/pii/reveal`, so the web `MaskedReveal` control drives it with only
 * a path change. Guarantees, in order:
 *  1. The field must be on a server-side allow-list (never a client column name);
 *     bank account stays write-only and is not revealable (422).
 *  2. Role gate per field (fail closed 403).
 *  3. A reason of at least 10 characters is mandatory.
 *  4. The vendor must exist in the caller's tenant, else 404.
 *  5. AUDIT FIRST, fail closed: the audit event is published BEFORE the value is
 *     returned; if it cannot be published nothing is revealed. The audit never
 *     carries the value.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { auditPiiReveal } from "../../shared/read-audit.js";
import * as repo from "./repo.js";

type RevealColumn = "pan" | "phone" | "email" | "contactPerson";

const OFFICER_ROLES = ["procurement_officer", "procurement_admin", "super_admin"];

/** API field name -> vendor column + roles allowed to reveal it. */
export const REVEALABLE_VENDOR_FIELDS: Record<string, { column: RevealColumn; roles: string[] }> = {
  // The contact channel an officer needs day to day.
  phone: { column: "phone", roles: OFFICER_ROLES },
  email: { column: "email", roles: OFFICER_ROLES },
  contactPerson: { column: "contactPerson", roles: OFFICER_ROLES },
  // A tax identifier: admin and auditor only.
  pan: { column: "pan", roles: ["procurement_admin", "super_admin", "audit_officer"] },
};

const revealBody = z.object({
  resourceType: z.literal("vendor"),
  resourceId: z.string().uuid(),
  field: z.string().min(1).max(64),
  reason: z.string().trim().min(10, "state why you need the clear value (at least 10 characters)").max(2000),
});

export async function vendorPiiRevealRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/pii/reveal", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = revealBody.parse(req.body ?? {});
    const spec = Object.hasOwn(REVEALABLE_VENDOR_FIELDS, body.field) ? REVEALABLE_VENDOR_FIELDS[body.field] : undefined;
    if (!spec) throw new HttpError(422, "FIELD_NOT_REVEALABLE", `field '${body.field}' is not revealable for vendor`);
    requireRole(ctx, spec.roles);

    const vendor = await repo.findVendorById(body.resourceId, ctx.tenantId);
    if (!vendor) throw new HttpError(404, "NOT_FOUND", "vendor not found");

    // Audit first, fail closed: no published audit event, no reveal.
    await auditPiiReveal(ctx, { vendorId: body.resourceId, field: body.field, reason: body.reason });

    const value = (vendor[spec.column] as string | null | undefined) ?? null;
    void reply.header("cache-control", "no-store");
    return reply.send({ data: { resourceType: "vendor", resourceId: body.resourceId, field: body.field, value } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
