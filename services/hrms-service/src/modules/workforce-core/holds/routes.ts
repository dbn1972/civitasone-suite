/**
 * Hold-registry read API (SmartTransfer OS, ST-M01-10).
 *
 * GET /v1/hrms/workforce-core/employees/:employeeId/holds?asOf=YYYY-MM-DD
 *
 * The eligibility read SmartTransfer consumes (getOrLoad-able — see
 * holds/queries.ts). It exposes the EXISTING hold registry
 * (`lifecycle.hrms_employee_holds`) read-only; it never writes it and defines
 * no new hold type (PROPOSED D-ST-16). Spec §4, §11.
 *
 * Authorisation (house rule 9):
 *   • STAFF-ONLY — requireRole(READER_ROLES) excludes `citizen`.
 *   • TENANT/JURISDICTION-SCOPED — the tenant comes from the server context
 *     (never a client id) and PostgreSQL RLS on the holds table enforces it on
 *     the read path (scopedRead); a cross-tenant employee id returns an empty
 *     active-holds view, never another tenant's rows.
 *
 * It is mounted only when WORKFORCE_CORE_LEDGER_ENABLED is on (app.ts gates
 * registration), so a deployment that has not turned the ledger on exposes no
 * new surface. If reached while off it returns 503 FEATURE_DISABLED.
 */
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../../shared/context.js";
import { isPostingLedgerEnabled } from "../config.js";
import { getEmployeeHolds, todayIso } from "./queries.js";

// Staff who may read eligibility holds: HR back-office + the SmartTransfer
// cycle operator roles. `citizen` is excluded (staff-only). A plain `employee`
// is NOT included — a hold is competent-authority information, not self-service
// (mirrors the POSTING_ROLES / HR_ADMIN posture of the write path).
export const HOLDS_READER_ROLES = [
  "hr_admin",
  "hr_officer",
  "super_admin",
  "transfer_officer",
  "transfer_admin",
];

const holdsQuery = z.object({
  /** Point-in-time to evaluate active holds; defaults to today (UTC). */
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .optional(),
});

export async function holdsReadRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/hrms/workforce-core/employees/:employeeId/holds",
    async (req, reply) => {
      if (!isPostingLedgerEnabled()) {
        throw new HttpError(
          503,
          "FEATURE_DISABLED",
          "the Workforce Core hold registry is not enabled for this deployment",
        );
      }
      const ctx = resolveContext(req);
      requireRole(ctx, HOLDS_READER_ROLES);
      const { employeeId } = z
        .object({ employeeId: z.string().uuid() })
        .parse(req.params);
      const { asOf } = holdsQuery.parse(req.query ?? {});
      const view = await getEmployeeHolds(
        ctx.tenantId,
        employeeId,
        asOf ?? todayIso(),
      );
      return reply.send({ data: view });
    },
  );

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError)
      return reply
        .code(400)
        .send({
          code: "VALIDATION_FAILED",
          message: "invalid request",
          correlationId,
          fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
        });
    if (err instanceof HttpError)
      return reply
        .code(err.status)
        .send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply
      .code(500)
      .send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
