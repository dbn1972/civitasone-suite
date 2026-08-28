/**
 * Medical Claims Module
 *
 * Endpoints:
 *  POST   /v1/hrms/medical/claims            — submit medical claim
 *  GET    /v1/hrms/medical/claims            — list my claims
 *  PATCH  /v1/hrms/medical/claims/:id/approve — HR approves/rejects
 *  GET    /v1/hrms/medical/hospitals         — empanelled hospital list
 *  GET    /v1/hrms/medical/insurance         — my insurance details (CGHS/state)
 *  GET    /v1/hrms/medical/history           — medical history timeline
 *
 * Schema: employee_id, claim_type (indoor/outdoor/reimbursement/advance), amount (paise),
 *         hospital_name, hospital_id, diagnosis, documents[], status, dependant_name, dependant_relation
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer"];
const SELF_ROLES = [...HR_ROLES, "manager", "employee"];

/**
 * medical.hrms_medical_claims has RLS ENABLEd and FORCEd (migration
 * 0040_medical_claims.sql), and this module talks to `sqlClient` directly (no
 * Drizzle schema attached in this file, so there is no `db.transaction()` —
 * where `wrapWithTenantGuc` injects `app.tenant_id` — anywhere in the call
 * path). Without this, every query below would run with no GUC set and the
 * connecting role (`hrms_svc`, NOBYPASSRLS non-superuser) would get a row-
 * security violation on write / zero rows back on read, silently: RLS fails
 * CLOSED. See `@civitasone/db`'s `withRawTenantGuc` for the shared fix
 * (already applied the same way in this service's workforce-planning module).
 */
function withTenantGuc<T>(
  tenantId: string,
  fn: (tx: typeof sqlClient) => Promise<T>,
): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, fn);
}

const submitClaimBody = z.object({
  employeeId: z.string().uuid(),
  // Must match migration 0040_medical_claims.sql's hrms_medical_claims_type_check
  // CHECK constraint (and schema.ts's claimType comment) — not an arbitrary choice.
  claimType: z.enum(["indoor", "outdoor", "reimbursement", "advance"]),
  amountMinor: z.coerce.number().int().min(1).describe("Amount in paise"),
  hospitalName: z.string().min(1).max(256),
  hospitalId: z.string().uuid().optional(),
  diagnosis: z.string().min(1).max(1000),
  documents: z.array(z.string().url().or(z.string().min(1).max(512))).default([]),
  dependantName: z.string().max(128).optional(),
  // Must match hrms_medical_claims_relation_check in migration 0040.
  dependantRelation: z.enum(["self", "spouse", "child", "parent"]).optional(),
  remarks: z.string().max(2000).optional(),
});

const approveBody = z.object({
  status: z.enum(["approved", "rejected"]),
  approvedAmountMinor: z.coerce.number().int().min(0).optional(),
  remarks: z.string().max(2000).optional(),
});

export async function medicalClaimsRoutes(app: FastifyInstance): Promise<void> {
  // Submit medical claim
  app.post("/v1/hrms/medical/claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);
    const body = submitClaimBody.parse(req.body);

    const id = randomUUID();
    await withTenantGuc(ctx.tenantId, (tx) => tx`
      INSERT INTO medical.hrms_medical_claims (
        id, tenant_id, employee_id, claim_type, amount_minor, hospital_name,
        hospital_id, diagnosis, documents, status, dependant_name, dependant_relation,
        remarks, created_by, updated_by
      ) VALUES (
        ${id}, ${ctx.tenantId}, ${body.employeeId}, ${body.claimType},
        ${body.amountMinor}, ${body.hospitalName}, ${body.hospitalId ?? null},
        ${body.diagnosis}, ${JSON.stringify(body.documents)}, 'pending',
        ${body.dependantName ?? null}, ${body.dependantRelation ?? null},
        ${body.remarks ?? null}, ${ctx.actorId}, ${ctx.actorId}
      )
    `);

    return reply.code(201).send({
      data: { id, employeeId: body.employeeId, status: "pending", amountMinor: body.amountMinor },
    });
  });

  // List my claims
  app.get("/v1/hrms/medical/claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);

    const query = z.object({
      employeeId: z.string().uuid().optional(),
      // Must match hrms_medical_claims_status_check in migration 0040 ("settled", not "paid").
      status: z.enum(["pending", "approved", "rejected", "settled"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT id, employee_id, claim_type, amount_minor::text, hospital_name,
             hospital_id, diagnosis, documents, status, dependant_name,
             dependant_relation, approved_amount_minor::text, remarks,
             created_at, updated_at
      FROM medical.hrms_medical_claims
      WHERE tenant_id = ${ctx.tenantId}
        ${query.employeeId ? tx`AND employee_id = ${query.employeeId}` : tx``}
        ${query.status ? tx`AND status = ${query.status}` : tx``}
      ORDER BY created_at DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `);

    return reply.send({ data: rows });
  });

  // HR approve/reject claim
  app.patch("/v1/hrms/medical/claims/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = approveBody.parse(req.body);

    const approvedAmount = await withTenantGuc(ctx.tenantId, async (tx) => {
      const [existing] = await tx`
        SELECT id, status, amount_minor::text as amount_minor
        FROM medical.hrms_medical_claims
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `;
      if (!existing) throw new HttpError(404, "NOT_FOUND", "medical claim not found");
      if (existing.status !== "pending") {
        throw new HttpError(409, "WRONG_STATE", `claim is '${existing.status}', expected 'pending'`);
      }

      const amount = body.status === "approved"
        ? (body.approvedAmountMinor ?? Number(existing.amount_minor))
        : 0;

      await tx`
        UPDATE medical.hrms_medical_claims
        SET status = ${body.status},
            approved_amount_minor = ${amount},
            remarks = COALESCE(${body.remarks ?? null}, remarks),
            approved_by = ${ctx.actorId},
            approved_at = NOW(),
            updated_by = ${ctx.actorId},
            updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `;

      return amount;
    });

    return reply.send({ data: { id, status: body.status, approvedAmountMinor: approvedAmount } });
  });

  // Empanelled hospital list
  app.get("/v1/hrms/medical/hospitals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);

    const query = z.object({
      city: z.string().max(128).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query);

    const rows = await sqlClient`
      SELECT id, name, city, state, type, empanelment_expiry, specialities
      FROM employee.empanelled_hospitals
      WHERE tenant_id = ${ctx.tenantId}
        ${query.city ? sqlClient`AND LOWER(city) = LOWER(${query.city})` : sqlClient``}
      ORDER BY name
      LIMIT ${query.limit}
    `;

    return reply.send({ data: rows });
  });

  // My insurance details
  app.get("/v1/hrms/medical/insurance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);

    const query = z.object({ employeeId: z.string().uuid() }).parse(req.query);

    const [row] = await sqlClient`
      SELECT employee_id, scheme_type, scheme_id, card_number, validity_from,
             validity_to, tier, dependants, annual_limit_minor::text
      FROM employee.medical_insurance
      WHERE tenant_id = ${ctx.tenantId} AND employee_id = ${query.employeeId}
    `;

    if (!row) throw new HttpError(404, "NOT_FOUND", "no insurance record found for employee");
    return reply.send({ data: row });
  });

  // Medical history timeline
  app.get("/v1/hrms/medical/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);

    const query = z.object({
      employeeId: z.string().uuid(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT id, claim_type, amount_minor::text, approved_amount_minor::text,
             hospital_name, diagnosis, status, dependant_name,
             created_at, approved_at
      FROM medical.hrms_medical_claims
      WHERE tenant_id = ${ctx.tenantId} AND employee_id = ${query.employeeId}
      ORDER BY created_at DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `);

    return reply.send({ data: rows });
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
