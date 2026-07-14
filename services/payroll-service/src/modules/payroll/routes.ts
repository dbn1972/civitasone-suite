import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { PayrollRunDetailListSchema, PayrollRunFullDetailSchema, SalarySlipSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, requirePermissionKey, HttpError } from "../../shared/context.js";
import { createStructureBody, createRunBody, idParam, createDdoBody, createPensionerBody } from "./validators.js";
import { payrollPensioners } from "./schema.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { db, scopedRead } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES  = [...PAYROLL_ROLES, "hr_admin", "finance_officer"];

export async function payrollRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, PayrollRunDetailListSchema, await queries.listRuns(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/structures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listStructures(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/runs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const run = await queries.getRunDetail(id, ctx.tenantId);
    if (!run) throw new HttpError(404, "NOT_FOUND", "run not found");
    sendValidated(reply, PayrollRunFullDetailSchema, run);
  });

  app.get("/v1/payroll/salary-slips", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, SalarySlipSummaryListSchema, await queries.listSalarySlips(ctx.tenantId, q.limit));
  });

  app.post("/v1/payroll/structures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = createStructureBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createStructure(ctx, body));
  });

  app.post("/v1/payroll/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = createRunBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRun(ctx, body));
  });

  app.patch("/v1/payroll/runs/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    await requirePermissionKey(ctx, "payroll.run.approve");
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveRun(ctx, id));
  });

  app.patch("/v1/payroll/runs/:id/disburse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.disburseRun(ctx, id));
  });

  app.patch("/v1/payroll/runs/:id/revert", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revertRun(ctx, id));
  });

  app.get("/v1/payroll/slips/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const slip = await queries.getSlip(id, ctx.tenantId);
    if (!slip) throw new HttpError(404, "NOT_FOUND", "slip not found");
    return reply.send(slip);
  });

  // ===================== Multi-DDO master data =====================
  app.get("/v1/payroll/ddos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT d.ddo_code, d.name,
             COALESCE(array_agg(m.department_id) FILTER (WHERE m.department_id IS NOT NULL), '{}') AS department_ids
      FROM payroll.payroll_ddos d
      LEFT JOIN payroll.payroll_ddo_departments m
        ON m.tenant_id = d.tenant_id AND m.ddo_code = d.ddo_code
      WHERE d.tenant_id = ${ctx.tenantId}::uuid
      GROUP BY d.ddo_code, d.name
      ORDER BY d.ddo_code
    `))) as unknown as Array<{ ddo_code: string; name: string; department_ids: string[] }>;
    return reply.send(rows.map((r) => ({ ddoCode: r.ddo_code, name: r.name, departmentIds: r.department_ids })));
  });

  app.post("/v1/payroll/ddos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = createDdoBody.parse(req.body);
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.payroll_ddos (tenant_id, ddo_code, name)
        VALUES (${ctx.tenantId}::uuid, ${body.ddoCode}, ${body.name})
        ON CONFLICT (tenant_id, ddo_code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      `);
      for (const deptId of body.departmentIds) {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_ddo_departments (tenant_id, department_id, ddo_code)
          VALUES (${ctx.tenantId}::uuid, ${deptId}::uuid, ${body.ddoCode})
          ON CONFLICT (tenant_id, department_id) DO UPDATE SET ddo_code = EXCLUDED.ddo_code
        `);
      }
    });
    return reply.code(201).send({ ddoCode: body.ddoCode, name: body.name, departmentIds: body.departmentIds });
  });

  // ===================== Pensioner master =====================
  app.get("/v1/payroll/pensioners", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, ppo_no, full_name, date_of_birth::text AS date_of_birth,
             basic_pension_minor, commuted_pension_minor, commutation_date::text AS commutation_date,
             medical_allowance_minor, ddo_code, tax_regime, status
      FROM payroll.payroll_pensioners
      WHERE tenant_id = ${ctx.tenantId}::uuid
      ORDER BY ppo_no
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send(rows.map((r) => ({
      id: r.id, ppoNo: r.ppo_no, fullName: r.full_name, dateOfBirth: r.date_of_birth,
      basicPensionMinor: Number(r.basic_pension_minor), commutedPensionMinor: Number(r.commuted_pension_minor),
      commutationDate: r.commutation_date, medicalAllowanceMinor: Number(r.medical_allowance_minor),
      ddoCode: r.ddo_code, taxRegime: r.tax_regime, status: r.status,
    })));
  });

  app.post("/v1/payroll/pensioners", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const b = createPensionerBody.parse(req.body);
    const id = randomUUID();
    // SEC-P1-06: insert via the Drizzle table so the encryptedText transform on
    // bank_account_no / bank_ifsc / pan applies — the previous raw-SQL INSERT
    // bypassed it and stored the PII in plaintext (DPDP violation).
    await db.insert(payrollPensioners).values({
      id,
      tenantId: ctx.tenantId,
      ppoNo: b.ppoNo,
      fullName: b.fullName,
      dateOfBirth: b.dateOfBirth,
      basicPensionMinor: b.basicPensionMinor,
      commutedPensionMinor: b.commutedPensionMinor ?? 0n,
      commutationDate: b.commutationDate ?? null,
      medicalAllowanceMinor: b.medicalAllowanceMinor ?? 0n,
      ddoCode: b.ddoCode ?? null,
      bankAccountNo: b.bankAccountNo ?? null,
      bankIfsc: b.bankIfsc ?? null,
      pan: b.pan ?? null,
      taxRegime: b.taxRegime,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    }).onConflictDoNothing();
    return reply.code(201).send({ id, ppoNo: b.ppoNo });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
