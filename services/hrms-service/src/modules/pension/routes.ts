/**
 * Pension / DCRG / Commutation / Family-pension routes (CCS rules).
 *
 *  GET  /v1/hrms/employees/:id/pension
 *       Query: retirementDate, daRatePct, commutePct, elBalanceDays,
 *              avgEmolumentsMinor (optional override), persist (true to save).
 *       Returns the structured breakup. If persist=true (and scheme is GPF) a
 *       row is written to pension.hrms_pension_records.
 *
 *  GET  /v1/hrms/employees/:id/pension/records
 *       Lists persisted pension records for the employee.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { computePension, elEncashment, summariseNonQualifying, type PensionResult, type ServiceBookEvent } from "./engine.js";
import * as serviceBookRepo from "../service-book/repo.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer", "payroll_admin"];
const idParam = z.object({ id: z.string().uuid() });

const query = z.object({
  retirementDate: z.string(),
  daRatePct: z.coerce.number().min(0).max(500).default(50),
  commutePct: z.coerce.number().min(0).max(40).default(40),
  elBalanceDays: z.coerce.number().int().min(0).default(0),
  ageNextBirthday: z.coerce.number().int().min(40).max(80).optional(),
  avgEmolumentsMinor: z.coerce.number().int().min(0).optional(),
  persist: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

/** Recursively convert bigint -> string for JSON. */
function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

export async function pensionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees/:id/pension", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const q = query.parse(req.query);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
      .limit(1));
    const emp = rows[0];
    if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");

    // P0-3: net qualifying service from the service book (non-qualifying spells:
    // dies-non, EOL-without-QS, suspension-as-non-duty, boy/temporary service).
    const sbEntries = await serviceBookRepo.listServiceBookEntries(ctx.tenantId, id);
    const sbEvents: ServiceBookEvent[] = sbEntries.map((e) => ({
      entryType: e.entryType,
      effectiveDate: e.effectiveDate,
      description: e.description,
    }));
    const nonQualifying = summariseNonQualifying(sbEvents);
    // Field-level PII / sensitive-data access log (cheap, structured).
    req.log.info({ event: "pension.read", employeeId: id, actorId: ctx.actorId, tenantId: ctx.tenantId }, "pension computed");

    const input: Parameters<typeof computePension>[0] = {
      pensionScheme: emp.pensionScheme,
      dateOfJoining: emp.dateOfJoining,
      retirementDate: q.retirementDate,
      lastBasicMinor: emp.basicMinor,
      daRatePct: q.daRatePct,
      commutePct: q.commutePct,
      nonQualifyingDays: nonQualifying.totalDays,
    };
    if (emp.dateOfBirth) input.dateOfBirth = emp.dateOfBirth;
    if (q.ageNextBirthday !== undefined) input.ageNextBirthday = q.ageNextBirthday;
    if (q.avgEmolumentsMinor !== undefined) input.avgEmolumentsMinor = BigInt(q.avgEmolumentsMinor);

    const result: PensionResult = computePension(input);
    const elEncashmentMinor = elEncashment(emp.basicMinor, q.daRatePct, q.elBalanceDays);

    let recordId: string | undefined;
    if (q.persist && result.definedBenefit) {
      recordId = randomUUID();
      await db.transaction(async (tx) => {
        await repo.insertPensionRecord(tx, {
          id: recordId!,
          tenantId: ctx.tenantId,
          employeeId: id,
          pensionScheme: result.pensionScheme,
          retirementDate: q.retirementDate,
          dateOfJoining: emp.dateOfJoining,
          lastBasicMinor: emp.basicMinor,
          daRatePct: String(q.daRatePct),
          avgEmolumentsMinor: result.avgEmolumentsMinor,
          qualifyingHalfYears: result.qualifying.halfYears,
          qualifyingYears: String(result.qualifying.years),
          monthlyPensionMinor: result.monthlyPensionMinor,
          commutedPct: String(result.commutation.commutePct),
          commutedValueMinor: result.commutation.commutedValueMinor,
          residualPensionMinor: result.commutation.residualMonthlyPensionMinor,
          dcrgMinor: result.dcrg.payableMinor,
          familyPensionNormalMinor: result.familyPension.normalMinor,
          familyPensionEnhancedMinor: result.familyPension.enhancedMinor,
          breakdown: jsonSafe(result) as Record<string, unknown>,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        });
      });
    }

    return reply.send(
      jsonSafe({
        employeeId: id,
        employeeNo: emp.employeeNo,
        fullName: emp.fullName,
        currency: emp.currency,
        inputs: {
          retirementDate: q.retirementDate,
          daRatePct: q.daRatePct,
          commutePct: q.commutePct,
          elBalanceDays: q.elBalanceDays,
        },
        ...result,
        nonQualifyingService: nonQualifying,
        elEncashment: {
          elBalanceDays: q.elBalanceDays,
          cappedDays: Math.min(q.elBalanceDays, 300),
          amountMinor: elEncashmentMinor,
        },
        ...(recordId ? { persistedRecordId: recordId } : {}),
      }),
    );
  });

  app.get("/v1/hrms/employees/:id/pension/records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const records = await repo.listByEmployee(ctx.tenantId, id);
    return reply.send({ data: jsonSafe(records) });
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
