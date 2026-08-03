import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { withRawTenantGuc } from "@civitasone/db";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";
import { fileFromModuleBody, refQuery } from "./validators.js";
import * as commands from "./commands.js";
import { checkEligibility, tenantHasOperators } from "../operators/eligibility.js";

// Any authenticated service-account or officer from a source module can raise a file.
const INITIATOR_ROLES = [
  "estab_officer", "estab_admin", "super_admin",
  "finance_officer", "finance_admin",
  "hr_officer", "hr_admin",
  "procurement_officer", "procurement_admin",
  "grant_officer", "grant_admin",
  "service_account",
];

const READER_ROLES = [...INITIATOR_ROLES, "audit_officer"];

export async function linkageRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/estab/files/from-module
   * Any module raises an eFile for formal, auditable approval.
   * The approved decision flows back to the source module automatically.
   */
  app.post("/v1/estab/files/from-module", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INITIATOR_ROLES);
    const body = fileFromModuleBody.parse(req.body);

    // Files may only be held/operated by enrolled eOffice operators — enforced
    // once the tenant has adopted the operator model (greenfield raises aren't
    // blocked before operators exist).
    if (await tenantHasOperators(ctx.tenantId)) {
      const holder = await checkEligibility(ctx.tenantId, body.currentWith, {});
      if (!holder.eligible) {
        throw new HttpError(422, "NOT_AN_OPERATOR", "the receiving officer (currentWith) is not an active eOffice operator");
      }
      const initiator = await checkEligibility(ctx.tenantId, body.initiatedBy, { requireInitiate: true });
      if (!initiator.eligible) {
        throw new HttpError(422, "CANNOT_INITIATE", "the initiating officer is not enrolled as an eOffice operator with initiate rights");
      }
    }

    const result = await commands.raiseFileFromModule(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, result);
  });

  /**
   * GET /v1/estab/files/by-ref?refType=...&refId=...
   * Source modules query the file status for an entity they raised.
   */
  app.get("/v1/estab/files/by-ref", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = refQuery.parse(req.query);

    // files.estab_files has RLS ENABLEd AND FORCEd; this module has no Drizzle
    // schema for a composite by-ref lookup, so there is no db.transaction() —
    // the only place wrapWithTenantGuc sets app.tenant_id — in the call path.
    // Without this, the connecting role (estab_svc, not a superuser) gets
    // zero rows back on every call, silently: RLS fails CLOSED. See
    // @civitasone/db's withRawTenantGuc for the shared fix.
    const rows = await withRawTenantGuc(sqlClient, ctx.tenantId, (tx) => tx`
      SELECT id, file_no, subject, status, classification, current_with,
             source_ref_type, source_ref_id, initiated_by, approval_chain, created_at, updated_at
      FROM files.estab_files
      WHERE tenant_id = ${ctx.tenantId}
        AND source_ref_type = ${q.refType}
        AND source_ref_id = ${q.refId}
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "no file found for this reference");
    }
    return reply.send({ data: rows[0] });
  });

  /**
   * GET /v1/estab/files/:id/decision-log
   * View the decision callbacks emitted for a file (audit/observability).
   */
  app.get("/v1/estab/files/:id/decision-log", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };

    // files.module_decision_log is also RLS ENABLEd AND FORCEd — same gap as
    // above, see withRawTenantGuc.
    const rows = await withRawTenantGuc(sqlClient, ctx.tenantId, (tx) => tx`
      SELECT decision, callback_topic, noting_id, dsc_hash, decided_by, decided_at
      FROM files.module_decision_log
      WHERE tenant_id = ${ctx.tenantId} AND file_id = ${id}
      ORDER BY decided_at DESC
    `);
    return reply.send({ data: rows });
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
