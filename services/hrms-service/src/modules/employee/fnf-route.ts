/**
 * P2-004: F&F (Full & Final Settlement) Calculator
 * POST /v1/hrms/employees/:id/fnf-calculate
 *
 * Computes:
 * - notice_buyout = (basic/30) * (notice_days - served_days)
 * - leave_encashment = (basic/30) * leave_balance_days
 * - gratuity = (basic * 15/26) * years_of_service (if >= 5 years)
 * Returns the F&F breakdown.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { eq, and } from "drizzle-orm";
import { hrmsEmployees } from "./schema.js";
import { hrmsLeaveAllocs } from "../leave/schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer", "payroll_admin"];

const idParam = z.object({ id: z.string().uuid() });

const fnfBody = z.object({
  separationDate: z.string(), // ISO date of separation
  noticePeriodDays: z.number().int().min(0).default(90),
  noticeDaysServed: z.number().int().min(0).default(0),
  lastWorkingDate: z.string().optional(),
});

export async function fnfRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/fnf-calculate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = fnfBody.parse(req.body);

    // Fetch employee
    const empRows = await db.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
      .limit(1);
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
    const allocations = await db.select().from(hrmsLeaveAllocs)
      .where(and(
        eq(hrmsLeaveAllocs.tenantId, ctx.tenantId),
        eq(hrmsLeaveAllocs.employeeId, id),
      ));
    const totalLeaveBalance = allocations.reduce((sum, a) => sum + (a.balanceDays ?? 0), 0);
    const leaveEncashmentMinor = dailyBasicMinor * totalLeaveBalance;

    // 3. Gratuity (only if >= 5 years of service)
    // Formula: (basic * 15) / 26 * completed_years
    let gratuityMinor = 0;
    const completedYears = Math.floor(yearsOfService);
    if (completedYears >= 5) {
      gratuityMinor = Math.round((basicMinor * 15 * completedYears) / 26);
    }

    // Total F&F
    const totalMinor = noticeBuyoutMinor + leaveEncashmentMinor + gratuityMinor;

    return reply.send({
      employeeId: id,
      employeeNo: emp.employeeNo,
      fullName: emp.fullName,
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
        },
        gratuity: {
          eligible: completedYears >= 5,
          completedYears,
          amountMinor: gratuityMinor,
        },
      },
      totalFnfMinor: totalMinor,
    });
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
