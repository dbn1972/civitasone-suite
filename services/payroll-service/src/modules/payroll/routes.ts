import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
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
import { lockedThroughMonth } from "../pay-profiles/rules-api.js";
import { maskPpoNo } from "./fin03-domain.js";
import { listRunWarnings } from "./run-warnings.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES  = [...PAYROLL_ROLES, "hr_admin", "finance_officer"];
// payroll-critical fix: an employee viewing their OWN payslip, layered on
// top of READER_ROLES below (never in place of it).
const SLIP_ROLES = [...READER_ROLES, "employee"];

export async function payrollRoutes(app: FastifyInstance): Promise<void> {
  /**
   * PAY-PROFILES: internal, read-only. The latest YYYY-MM holding an approved
   * or disbursed salary run (pensioner runs excluded) -- i.e. the last LOCKED
   * pay period. hrms-service refuses a pay-profile change that would start on
   * or before it. `null` when nothing is locked yet.
   */
  app.get("/v1/payroll/internal/locked-through", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...PAYROLL_ROLES, "hr_admin"]);
    return reply.send({ lockedThrough: await scopedRead((tx) => lockedThroughMonth(tx, ctx.tenantId)) });
  });

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

  // Non-blocking warnings the run engine recorded for this run (PT_STATE_UNKNOWN, PT_GENDER_UNKNOWN,
  // HRA_FLOOR_NOT_CONFIGURED). Same roles as the run detail; employee numbers only, no other PII.
  app.get("/v1/payroll/runs/:id/warnings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const out = await scopedRead(async (tx) => {
      const exists = (await tx.execute(sql`SELECT 1 FROM payroll.payroll_runs WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid`)) as unknown as unknown[];
      return exists.length === 0 ? null : listRunWarnings(tx as never, ctx.tenantId, id);
    });
    if (!out) throw new HttpError(404, "NOT_FOUND", "run not found");
    return reply.send({ runId: id, warnings: out });
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
   * GAP-PAYROLL-SALARY-SLIPS-04: "My payslips". Returns ONLY the caller's own
   * slips. The employee is resolved from the verified token (actor -> HRMS
   * identity); any employeeId in the query or body is ignored, and the tenant
   * comes from the token. Paging is bounded (max 100, newest period first).
   * Registered before /slips/:id; fastify matches the static segment first.
   */
  app.get("/v1/payroll/slips/mine", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SLIP_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(24),
      offset: z.coerce.number().int().min(0).max(10_000).default(0),
    }).parse(req.query);
    let ownEmployeeId: string | null;
    try {
      ownEmployeeId = await resolveActorEmployeeId(ctx.tenantId, ctx.actorId);
    } catch (err) {
      if (err instanceof HrmsUnavailableError) {
        throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot resolve your employee record: HRMS identity source unreachable");
      }
      throw err;
    }
    if (!ownEmployeeId) return sendValidated(reply, SalarySlipSummaryListSchema, []);
    sendValidated(reply, SalarySlipSummaryListSchema, await queries.listMySlips(ctx.tenantId, ownEmployeeId, q.limit, q.offset));
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
      SELECT d.ddo_code, d.name, d.is_active,
             COALESCE(array_agg(m.department_id) FILTER (WHERE m.department_id IS NOT NULL), '{}') AS department_ids
      FROM payroll.payroll_ddos d
      LEFT JOIN payroll.payroll_ddo_departments m
        ON m.tenant_id = d.tenant_id AND m.ddo_code = d.ddo_code
      WHERE d.tenant_id = ${ctx.tenantId}::uuid
      GROUP BY d.ddo_code, d.name, d.is_active
      ORDER BY d.ddo_code
    `))) as unknown as Array<{ ddo_code: string; name: string; is_active: boolean; department_ids: string[] }>;
    // GAP-PAYROLL-DDOS-03: isActive lets the UI show status + offer (de)activate.
    return reply.send(rows.map((r) => ({ ddoCode: r.ddo_code, name: r.name, isActive: r.is_active !== false, departmentIds: r.department_ids })));
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
      // GAP-PAYROLL-PENSIONERS-04: the register lists the PPO number MASKED;
      // the full value is only served by the audited reveal endpoint (fin03-routes.ts).
      id: r.id, ppoNo: maskPpoNo(String(r.ppo_no ?? "")), ppoNoMasked: true, fullName: r.full_name, dateOfBirth: r.date_of_birth,
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
