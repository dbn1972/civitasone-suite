/**
 * PAY-PROFILES routes (maker-checker, CQRS: every write publishes a command
 * and returns 202; the consumer persists + audits).
 *
 *  POST /v1/hrms/employees/:id/pay-profile        request a profile change (maker)
 *  GET  /v1/hrms/employees/:id/pay-profile        current + history
 *  GET  /v1/hrms/pay-profiles/pending             requests awaiting a decision
 *  POST /v1/hrms/pay-profiles/:profileId/approve  checker (never the requester)
 *  POST /v1/hrms/pay-profiles/:profileId/reject   checker (never the requester)
 *  GET  /v1/hrms/pay-profiles/advisories?month=   read-only clean-up list
 *
 * A profile only changes pay once APPROVED; no approved profile == govt_scale.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as employeeRepo from "../employee/repo.js";
import { loadTypeCategoryResolver } from "../employee/engagement-policy.js";
import { fetchPayrollLockedThrough, PayrollUnavailableError } from "../../shared/payroll-client.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  PAY_PROFILES, isPayProfile, planApproval, resolveProfileForMonth, validateProfileRequest, applyMoneyTerms, moneyTermsOf,
  requiredPayOption, type DeputationMoneyTerms,
} from "./domain.js";
import { buildEmployeePayFeed } from "./feed.js";

const WRITE_ROLES = ["hr_admin", "payroll_admin", "super_admin"];
const READ_ROLES = ["hr_admin", "hr_officer", "payroll_admin", "payroll_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const profileParam = z.object({ profileId: z.string().uuid() });
const minorString = z.string().regex(/^\d{1,15}$/, "amount in paise as a digit string");

const requestBody = z.object({
  payProfile: z.enum(PAY_PROFILES),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/, "must be the 1st of a month (YYYY-MM-01)"),
  deputationId: z.string().uuid().optional(),
  consolidatedMonthlyMinor: minorString.optional(),
  /**
   * Deputation profiles: money-term changes to approve WITH this profile
   * (e.g. a revised parent basic, station or allowance). Merged over the
   * deputation's current terms; the merged result is what gets approved.
   */
  deputationTerms: z.object({
    stationType: z.enum(["same", "other"]).nullable(),
    parentPayLevel: z.number().int().min(1).max(18).nullable(),
    parentBasicMinor: minorString.nullable(),
    postPayLevel: z.number().int().min(1).max(18).nullable(),
    postBasicMinor: minorString.nullable(),
    allowanceMode: z.enum(["auto", "fixed"]),
    deputationAllowanceMinor: minorString,
    daSource: z.enum(["central", "parent"]),
    parentDaRateBps: z.number().int().min(0).max(100000).nullable(),
    parentPensionScheme: z.enum(["GPF", "NPS", "EPF"]).nullable(),
  }).partial().optional(),
  orderRef: z.string().max(120).optional(),
  remarks: z.string().max(2000).optional(),
});
const decisionBody = z.object({ note: z.string().max(500).optional() });

function serialize(r: Awaited<ReturnType<typeof repo.findById>>) {
  if (!r) return null;
  return {
    id: r.id, employeeId: r.employeeId, payProfile: r.payProfile,
    effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, status: r.status,
    deputationId: r.deputationId,
    consolidatedMonthlyMinor: r.consolidatedMonthlyMinor == null ? null : r.consolidatedMonthlyMinor.toString(),
    deputationTerms: r.deputationTerms ?? null,
    orderRef: r.orderRef, remarks: r.remarks,
    requestedBy: r.requestedBy, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    createdAt: r.createdAt,
  };
}

async function mustEmployee(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
  const emp = rows[0];
  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
  return emp;
}

/** Latest locked (approved/disbursed) payroll month; fail closed if payroll is unreachable. */
async function lockedThrough(tenantId: string): Promise<string | null> {
  try {
    return await fetchPayrollLockedThrough(tenantId);
  } catch (err) {
    if (err instanceof PayrollUnavailableError) {
      throw new HttpError(503, "PAYROLL_UNAVAILABLE", "cannot verify the locked payroll period right now; retry shortly");
    }
    throw err;
  }
}

/**
 * Full validation of a (requested or pending) assignment against current
 * state. Shared by request and approve so an approval re-checks everything.
 */
async function assertAssignable(tenantId: string, input: {
  employeeId: string; payProfile: (typeof PAY_PROFILES)[number]; effectiveFrom: string;
  deputationId: string | null; consolidatedMonthlyMinor: bigint | null;
  /** Request: overrides merged over the deputation's terms. Approve: the stored approved copy. */
  termsOverride?: Partial<DeputationMoneyTerms>; termsSnapshot?: DeputationMoneyTerms | null;
}): Promise<DeputationMoneyTerms | null> {
  const emp = await mustEmployee(tenantId, input.employeeId);
  const engagement = (await loadTypeCategoryResolver(tenantId))(emp.employeeType);
  const dep = input.deputationId ? await repo.findDeputation(tenantId, input.deputationId) : null;
  const live = dep ? repo.toDeputationTerms(dep) : null;
  if (!requiredPayOption(input.payProfile) && input.termsOverride) {
    throw new HttpError(422, "DEPUTATION_TERMS_NOT_APPLICABLE", "deputationTerms only apply to deputation profiles");
  }
  const snapshot: DeputationMoneyTerms | null = live && requiredPayOption(input.payProfile)
    ? input.termsSnapshot ?? { ...moneyTermsOf(live), ...(input.termsOverride ?? {}) }
    : null;
  const error = validateProfileRequest({
    payProfile: input.payProfile,
    effectiveFrom: input.effectiveFrom,
    employeeId: input.employeeId,
    eligibleForPayroll: engagement.policy.eligibleForPayroll,
    paymentRoute: engagement.policy.paymentRoute,
    deputation: live && snapshot ? applyMoneyTerms(live, snapshot) : live,
    deputationIdGiven: input.deputationId != null,
    consolidatedMonthlyMinor: input.consolidatedMonthlyMinor,
    lockedThrough: await lockedThrough(tenantId),
  });
  if (error) throw new HttpError(error === "PERIOD_LOCKED" ? 409 : 422, error, `pay profile not assignable: ${error}`);
  return snapshot;
}

export async function payProfileRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/pay-profile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = requestBody.parse(req.body);
    const consolidated = body.consolidatedMonthlyMinor != null ? BigInt(body.consolidatedMonthlyMinor) : null;
    const deputationTerms = await assertAssignable(ctx.tenantId, {
      employeeId: id, payProfile: body.payProfile, effectiveFrom: body.effectiveFrom,
      deputationId: body.deputationId ?? null, consolidatedMonthlyMinor: consolidated,
      ...(body.deputationTerms ? { termsOverride: body.deputationTerms as Partial<DeputationMoneyTerms> } : {}),
    });
    const history = await repo.listByEmployee(ctx.tenantId, id);
    if (history.some((r) => r.status === "pending")) {
      throw new HttpError(409, "PROFILE_REQUEST_PENDING", "this employee already has a pay profile change awaiting a decision");
    }
    const plan = planApproval({ id: "new", effectiveFrom: body.effectiveFrom }, history.filter((r) => r.status === "active"));
    if ("error" in plan) throw new HttpError(409, plan.error, "a new pay profile must start after the employee's current one");
    const accepted = await commands.requestPayProfile(ctx, {
      employeeId: id,
      payProfile: body.payProfile,
      effectiveFrom: body.effectiveFrom,
      deputationId: body.deputationId ?? null,
      consolidatedMonthlyMinor: body.consolidatedMonthlyMinor ?? null,
      deputationTerms,
      orderRef: body.orderRef ?? null,
      remarks: body.remarks ?? null,
    });
    return reply.code(202).send(accepted);
  });

  app.get("/v1/hrms/employees/:id/pay-profile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    await mustEmployee(ctx.tenantId, id);
    const rows = await repo.listByEmployee(ctx.tenantId, id);
    const today = new Date().toISOString().slice(0, 10);
    const { row } = resolveProfileForMonth(rows.map(repo.toPayProfileRow), today.slice(0, 7), null);
    const current = row ? rows.find((r) => r.id === row.id) ?? null : null;
    return reply.send({
      current: current ? serialize(current) : { payProfile: "govt_scale", source: "default" },
      history: rows.map(serialize),
    });
  });

  app.get("/v1/hrms/pay-profiles/pending", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const rows = await repo.listPending(ctx.tenantId);
    return reply.send({ data: rows.map(serialize) });
  });

  for (const decision of ["approve", "reject"] as const) {
    app.post(`/v1/hrms/pay-profiles/:profileId/${decision}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, WRITE_ROLES);
      const { profileId } = profileParam.parse(req.params);
      const body = decisionBody.parse(req.body ?? {});
      const row = await repo.findById(ctx.tenantId, profileId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "pay profile request not found");
      if (row.status !== "pending") throw new HttpError(409, "NOT_PENDING", `pay profile request is already ${row.status}`);
      if (row.requestedBy === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "a pay profile change must be decided by someone other than its requester");
      }
      if (decision === "approve") {
        if (!isPayProfile(row.payProfile)) throw new HttpError(422, "UNKNOWN_PROFILE", row.payProfile);
        await assertAssignable(ctx.tenantId, {
          employeeId: row.employeeId, payProfile: row.payProfile, effectiveFrom: row.effectiveFrom,
          deputationId: row.deputationId, consolidatedMonthlyMinor: row.consolidatedMonthlyMinor,
          termsSnapshot: row.deputationTerms ?? null,
        });
        const active = (await repo.listByEmployee(ctx.tenantId, row.employeeId)).filter((r) => r.status === "active");
        const plan = planApproval(row, active);
        if ("error" in plan) throw new HttpError(409, plan.error, "a new pay profile must start after the employee's current one");
      }
      const accepted = await commands.decidePayProfile(ctx, profileId, decision, body.note ?? null);
      return reply.code(202).send(accepted);
    });
  }

  app.get("/v1/hrms/pay-profiles/advisories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const month = q.month ?? new Date().toISOString().slice(0, 7);
    const PAGE = 500;
    const employees: Awaited<ReturnType<typeof employeeRepo.listByTenant>> = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await employeeRepo.listByTenant(ctx.tenantId, PAGE, offset);
      employees.push(...page);
      if (page.length < PAGE) break;
    }
    const resolveEngagement = await loadTypeCategoryResolver(ctx.tenantId);
    const inputs = await repo.loadPayProfileFeedInputs(ctx.tenantId, month);
    const data = employees
      .filter((e) => e.status !== "separated")
      .map((e) => {
        const engagement = resolveEngagement(e.employeeType);
        if (!engagement.policy.eligibleForPayroll) return null;
        const feed = buildEmployeePayFeed(
          { id: e.id, employeeType: e.employeeType, dateOfJoining: e.dateOfJoining }, inputs, engagement, month,
        );
        if (feed.advisories.length === 0) return null;
        return {
          employeeId: e.id, employeeNo: e.employeeNo, fullName: e.fullName,
          employeeType: e.employeeType, engagementCategory: feed.engagement.category,
          payProfile: feed.payProfile.profile, advisories: feed.advisories,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return reply.send({ month, data });
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
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: err.status === 503 });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

