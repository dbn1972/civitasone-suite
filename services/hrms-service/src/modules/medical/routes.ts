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
 * Schema: employee_id, claim_type (OPD/IPD/dental/optical), amount (paise),
 *         hospital_name, hospital_id, diagnosis, documents[], status, dependant_name, dependant_relation
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer"];
const SELF_ROLES = [...HR_ROLES, "manager", "employee"];

const submitClaimBody = z.object({
  employeeId: z.string().uuid(),
  claimType: z.enum(["OPD", "IPD", "dental", "optical"]),
  amountMinor: z.coerce.number().int().min(1).describe("Amount in paise"),
  hospitalName: z.string().min(1).max(256),
  hospitalId: z.string().uuid().optional(),
  diagnosis: z.string().min(1).max(1000),
  documents: z.array(z.string().url().or(z.string().min(1).max(512))).default([]),
  dependantName: z.string().max(128).optional(),
  dependantRelation: z.string().max(64).optional(),
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
    await sqlClient`
      INSERT INTO employee.medical_claims (
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
    `;

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
      status: z.enum(["pending", "approved", "rejected", "paid"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await sqlClient`
      SELECT id, employee_id, claim_type, amount_minor::text, hospital_name,
             hospital_id, diagnosis, documents, status, dependant_name,
             dependant_relation, approved_amount_minor::text, remarks,
             created_at, updated_at
      FROM employee.medical_claims
      WHERE tenant_id = ${ctx.tenantId}
        ${query.employeeId ? sqlClient`AND employee_id = ${query.employeeId}` : sqlClient``}
        ${query.status ? sqlClient`AND status = ${query.status}` : sqlClient``}
      ORDER BY created_at DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;

    return reply.send({ data: rows });
  });

  // HR approve/reject claim
  app.patch("/v1/hrms/medical/claims/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = approveBody.parse(req.body);

    const [existing] = await sqlClient`
      SELECT id, status, amount_minor::text as amount_minor
      FROM employee.medical_claims
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `;
    if (!existing) throw new HttpError(404, "NOT_FOUND", "medical claim not found");
    if (existing.status !== "pending") {
      throw new HttpError(409, "WRONG_STATE", `claim is '${existing.status}', expected 'pending'`);
    }

    const approvedAmount = body.status === "approved"
      ? (body.approvedAmountMinor ?? Number(existing.amount_minor))
      : 0;

    await sqlClient`
      UPDATE employee.medical_claims
      SET status = ${body.status},
          approved_amount_minor = ${approvedAmount},
          remarks = COALESCE(${body.remarks ?? null}, remarks),
          decided_by = ${ctx.actorId},
          decided_at = NOW(),
          updated_by = ${ctx.actorId},
          updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `;

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

    const rows = await sqlClient`
      SELECT id, claim_type, amount_minor::text, approved_amount_minor::text,
             hospital_name, diagnosis, status, dependant_name,
             created_at, decided_at
      FROM employee.medical_claims
      WHERE tenant_id = ${ctx.tenantId} AND employee_id = ${query.employeeId}
      ORDER BY created_at DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;

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
