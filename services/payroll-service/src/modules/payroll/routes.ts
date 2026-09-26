import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { PayrollRunDetailListSchema, PayrollRunFullDetailSchema, SalarySlipSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, requirePermissionKey, isSelfServiceEmployee, HttpError } from "../../shared/context.js";
import { createStructureBody, createRunBody, idParam, createDdoBody, createPensionerBody, listRunsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { scopedRead } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import { resolveActorEmployeeId, HrmsUnavailableError } from "../../shared/hrms-client.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES  = [...PAYROLL_ROLES, "hr_admin", "finance_officer"];
// payroll-critical fix: an employee viewing their OWN payslip, layered on
// top of READER_ROLES below (never in place of it).
const SLIP_ROLES = [...READER_ROLES, "employee"];

export async function payrollRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listRunsQuery.parse(req.query);
    sendValidated(reply, PayrollRunDetailListSchema, await queries.listRuns(ctx.tenantId, q.limit, q.month));
  });

  app.get("/v1/payroll/structures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listStructures(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/components", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listComponents(ctx.tenantId, q.limit);
    return reply.send({ data: rows, meta: { page: 1, pageSize: q.limit, total: rows.length } });
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

  /**
   * payroll-critical fix: this used to be READER_ROLES-only, so an employee
   * got "Access restricted" on their OWN payslip -- there was no
   * self-service payslip route anywhere in the app (confirmed against the
   * full nav-route manifest). Same established pattern as hrms-service's
   * medical/skills/work-summaries self-scoping (resolveEmployeeForActor /
   * resolveSelfScopedEmployeeId), applied across the service boundary via
   * resolveActorEmployeeId (hrms-client.ts), since payroll-service has no
   * employee-identity table of its own to resolve "is this MY record"
   * in-process the way those hrms-service modules do.
   */
  app.get("/v1/payroll/slips/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SLIP_ROLES);
    const { id } = idParam.parse(req.params);
    const slip = await queries.getSlip(id, ctx.tenantId);
    if (!slip) throw new HttpError(404, "NOT_FOUND", "slip not found");
    if (isSelfServiceEmployee(ctx)) {
      let ownEmployeeId: string | null;
      try {
        ownEmployeeId = await resolveActorEmployeeId(ctx.tenantId, ctx.actorId);
      } catch (err) {
        // Mirrors commands.ts's assertEmployeeExists: remap HrmsUnavailableError
        // to the same 502 HRMS_UNAVAILABLE this service's other HRMS-dependent
        // call sites use, instead of letting it fall through to this file's
        // errorHandler's generic 500 catch-all.
        if (err instanceof HrmsUnavailableError) {
          throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot verify payslip ownership: HRMS identity source unreachable");
        }
        throw err;
      }
      if (!ownEmployeeId || ownEmployeeId !== slip.employeeId) {
        throw new HttpError(403, "FORBIDDEN", "employees may only access their own payslip");
      }
    }
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

  // CQRS lift (quality-payroll-95): was a synchronous upsert in the request
  // path; now publishes payroll.ddo.upsert and returns 202 — the ddoUpsert
  // consumer (payroll/consumer.js) applies the same upsert asynchronously.
  app.post("/v1/payroll/ddos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = createDdoBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertDdo(ctx, body));
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

  // CQRS lift (quality-payroll-95): was a synchronous Drizzle insert in the
  // request path; now publishes payroll.pensioner.create and returns 202 —
  // the pensionerCreate consumer (payroll/consumer.js) persists it
  // asynchronously via the SAME Drizzle table (encryptedText PII transform
  // on bank_account_no/bank_ifsc/pan still applies — SEC-P1-06 preserved).
  app.post("/v1/payroll/pensioners", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const b = createPensionerBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPensioner(ctx, b));
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
