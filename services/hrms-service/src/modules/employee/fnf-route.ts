/**
 * P2-004: F&F (Full & Final Settlement) Calculator
 * POST /v1/hrms/employees/:id/fnf-calculate
 *
 * Computes:
 * - notice_buyout = (basic/30) * (notice_days - served_days)
 * - leave_encashment = (basic/30) * leave_balance_days
 * - gratuity = (basic * 15/26) * years_of_service (if >= 5 years)
 * Returns the F&F breakdown with optional tax breakdown from payroll-service.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { eq, and } from "drizzle-orm";
import { hrmsEmployees } from "./schema.js";
import { hrmsLeaveAllocs } from "../leave/schema.js";
import { fetchFnfTaxBreakdown, PayrollUnavailableError } from "../../shared/payroll-client.js";
import { loadTypeResolver } from "./engagement-policy.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer", "payroll_admin"];

const idParam = z.object({ id: z.string().uuid() });

const fnfBody = z.object({
  separationDate: z.string(), // ISO date of separation
  noticePeriodDays: z.number().int().min(0).default(90),
  noticeDaysServed: z.number().int().min(0).default(0),
  lastWorkingDate: z.string().optional(),
  // Optional fields for tax computation (if provided, enables tax breakdown)
  separationType: z.enum(["retirement", "superannuation", "resignation", "retrenchment", "vrs", "death"]).optional(),
  employeeCategory: z.enum(["govt", "non_govt_covered", "non_govt_uncovered"]).optional(),
  avgSalaryLast10MonthsMinor: z.string().optional(), // bigint string
  priorLeaveEncashExemptionMinor: z.string().default("0"),
  remainingMonthsToRetirement: z.number().int().min(0).default(0),
  taxRegime: z.enum(["old", "new"]).default("new"),
  salaryYtdMinor: z.string().default("0"),
  tdsYtdMinor: z.string().default("0"),
  deductions80cMinor: z.string().default("0"),
  deductions80dMinor: z.string().default("0"),
  otherDeductionsMinor: z.string().default("0"),
  fyStartYear: z.number().int().optional(),
  retrenchmentCompMinor: z.string().default("0"),
  vrsCompMinor: z.string().default("0"),
  arrearsMinor: z.string().default("0"),
});

export async function fnfRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/fnf-calculate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = fnfBody.parse(req.body);

    // Fetch employee
    const empRows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
      .limit(1));
    const emp = empRows[0];
    if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");

    const basicMinor = Number(emp.basicMinor); // in minor units (paise)
    const dailyBasicMinor = Math.round(basicMinor / 30);

    // Calculate years of service
    const joiningDate = new Date(emp.dateOfJoining);
    const separationDate = new Date(body.separationDate);
    const msInYear = 365.25 * 24 * 60 * 60 * 1000;
    const yearsOfService = (separationDate.getTime() - joiningDate.getTime()) / msInYear;

    // 1. Notice Buyout
    const noticeShortfall = Math.max(0, body.noticePeriodDays - body.noticeDaysServed);
    const noticeBuyoutMinor = dailyBasicMinor * noticeShortfall;

    // 2. Leave Encashment — sum up balance days from all allocations
    const allocations = await scopedRead((tx) => tx.select().from(hrmsLeaveAllocs)
      .where(and(
        eq(hrmsLeaveAllocs.tenantId, ctx.tenantId),
        eq(hrmsLeaveAllocs.employeeId, id),
      )));
    const totalLeaveBalance = allocations.reduce((sum, a) => sum + (a.balanceDays ?? 0), 0);
    let leaveEncashmentMinor = dailyBasicMinor * totalLeaveBalance;

    // 3. Gratuity (only if >= 5 years of service)
    // Formula: (basic * 15) / 26 * completed_years
    let gratuityMinor = 0;
    const completedYears = Math.floor(yearsOfService);
    if (completedYears >= 5) {
      gratuityMinor = Math.round((basicMinor * 15 * completedYears) / 26);
    }

    // DIC engagement gate: consultant / third-party / apprentice types carry NO
    // gratuity or leave-encashment regardless of tenure. Resolved from the
    // employee's engagement policy (categorised types only; legacy/un-categorised
    // types stay permissive, so existing settlements are unchanged). Applied
    // before the total + the payroll tax breakdown so nothing reinstates them.
    // Fail-open: a resolver error must never break the settlement calculation.
    let engGratuityEligible = true;
    let engLeaveEncashEligible = true;
    try {
      const resolveType = await loadTypeResolver(ctx.tenantId);
      const engagementPolicy = resolveType(emp.employeeType);
      engGratuityEligible = engagementPolicy.eligibleForGratuity;
      engLeaveEncashEligible = engagementPolicy.leaveEncashment;
    } catch (err) {
      req.log.warn({ err }, "engagement policy resolve failed; F&F terminal benefits not gated");
    }
    const gratuityEligible = completedYears >= 5 && engGratuityEligible;
    if (!engGratuityEligible) gratuityMinor = 0;
    if (!engLeaveEncashEligible) leaveEncashmentMinor = 0;

    // Total F&F
    const totalMinor = noticeBuyoutMinor + leaveEncashmentMinor + gratuityMinor;

    // Attempt tax breakdown from payroll-service (graceful degradation)
    let taxBreakdown: Record<string, unknown> | undefined;
    let warning: string | undefined;

    // Derive FY start year from separation date (FY runs Apr–Mar in India)
    const sepMonth = separationDate.getMonth(); // 0-indexed
    const derivedFyStartYear = body.fyStartYear ?? (sepMonth >= 3 ? separationDate.getFullYear() : separationDate.getFullYear() - 1);

    try {
      const taxResult = await fetchFnfTaxBreakdown(ctx.tenantId, {
        employeeId: id,
        separationDate: body.separationDate,
        separationType: body.separationType ?? "resignation",
        employeeCategory: body.employeeCategory ?? "non_govt_covered",
        noticeBuyoutMinor: String(noticeBuyoutMinor),
        leaveEncashmentGrossMinor: String(leaveEncashmentMinor),
        gratuityGrossMinor: String(gratuityMinor),
        retrenchmentCompMinor: body.retrenchmentCompMinor,
        vrsCompMinor: body.vrsCompMinor,
        arrearsMinor: body.arrearsMinor,
        lastDrawnWagesMinor: String(basicMinor), // basic monthly as last drawn wages
        completedYears,
        avgSalaryLast10MonthsMinor: body.avgSalaryLast10MonthsMinor ?? String(basicMinor),
        leaveBalanceDays: totalLeaveBalance,
        priorLeaveEncashExemptionMinor: body.priorLeaveEncashExemptionMinor,
        remainingMonthsToRetirement: body.remainingMonthsToRetirement,
        taxRegime: body.taxRegime,
        salaryYtdMinor: body.salaryYtdMinor,
        tdsYtdMinor: body.tdsYtdMinor,
        deductions80cMinor: body.deductions80cMinor,
        deductions80dMinor: body.deductions80dMinor,
        otherDeductionsMinor: body.otherDeductionsMinor,
        fyStartYear: derivedFyStartYear,
      });

      taxBreakdown = {
        components: [
          {
            name: "gratuity",
            grossMinor: String(gratuityMinor),
            exemptMinor: taxResult.gratuityExemption.exemptMinor,
            taxableMinor: taxResult.gratuityExemption.taxableMinor,
            section: "10(10)",
            reason: completedYears >= 5 ? "eligible" : "ineligible (< 5 years)",
          },
          {
            name: "leaveEncashment",
            grossMinor: String(leaveEncashmentMinor),
            exemptMinor: taxResult.leaveEncashExemption.exemptMinor,
            taxableMinor: taxResult.leaveEncashExemption.taxableMinor,
            section: "10(10AA)",
            reason: "leave encashment on separation",
          },
          {
            name: "noticeBuyout",
            grossMinor: String(noticeBuyoutMinor),
            exemptMinor: "0",
            taxableMinor: String(noticeBuyoutMinor),
            section: null,
            reason: "fully taxable",
          },
          ...(taxResult.retrenchmentExemption
            ? [{
                name: "retrenchmentCompensation",
                grossMinor: body.retrenchmentCompMinor,
                exemptMinor: taxResult.retrenchmentExemption.exemptMinor,
                taxableMinor: taxResult.retrenchmentExemption.taxableMinor,
                section: "10(10B)",
                reason: "retrenchment compensation",
              }]
            : []),
          ...(taxResult.vrsExemption
            ? [{
                name: "vrsCompensation",
                grossMinor: body.vrsCompMinor,
                exemptMinor: taxResult.vrsExemption.exemptMinor,
                taxableMinor: taxResult.vrsExemption.taxableMinor,
                section: "10(10C)",
                reason: "voluntary retirement scheme",
              }]
            : []),
        ],
        totalTaxableOnSeparationMinor: taxResult.totalTaxableOnSeparationMinor,
        estimatedTdsOnSeparationMinor: taxResult.tdsOnSeparationMinor,
        totalExemptMinor: taxResult.totalExemptMinor,
        annualTaxableMinor: taxResult.annualTaxableMinor,
        netPayableMinor: taxResult.netPayableMinor,
      };
    } catch (err) {
      if (err instanceof PayrollUnavailableError) {
        req.log.warn({ err }, "payroll-service unavailable for fnf tax breakdown");
        warning = "Tax computation unavailable";
      } else {
        req.log.warn({ err }, "unexpected error fetching fnf tax breakdown");
        warning = "Tax computation unavailable";
      }
    }

    const response: Record<string, unknown> = {
      employeeId: id,
      employeeNo: emp.employeeNo,
      fullName: emp.fullName,
      engagementType: emp.employeeType,
      separationDate: body.separationDate,
      dateOfJoining: emp.dateOfJoining,
      yearsOfService: Math.round(yearsOfService * 100) / 100,
      basicMonthlyMinor: basicMinor,
      currency: emp.currency,
      breakdown: {
        noticeBuyout: {
          noticePeriodDays: body.noticePeriodDays,
          noticeDaysServed: body.noticeDaysServed,
          shortfallDays: noticeShortfall,
          amountMinor: noticeBuyoutMinor,
        },
        leaveEncashment: {
          leaveBalanceDays: totalLeaveBalance,
          amountMinor: leaveEncashmentMinor,
          engagementEligible: engLeaveEncashEligible,
        },
        gratuity: {
          eligible: gratuityEligible,
          completedYears,
          amountMinor: gratuityMinor,
          engagementEligible: engGratuityEligible,
        },
      },
      totalFnfMinor: totalMinor,
    };

    if (taxBreakdown) {
      response.taxBreakdown = taxBreakdown;
    }
    if (warning) {
      response.warning = warning;
    }

    return reply.send(response);
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
