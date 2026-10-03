/**
 * GAP-PAYROLL-PAY-GROUPS-03: pay-group membership routes.
 *
 * Payroll owns membership (payroll.employee_pay_group_assignments), keyed by
 * the hrms employee id; employee identity / names come from the existing
 * internal hrms lookups, never from the hrms schema. Mutations are
 * zod-validated, run read-only guards for a synchronous 4xx, publish a
 * command and return 202; pay-group-consumer.ts does the write.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import {
  searchEmployeeSummaries, searchEmployeeSummariesStrict, fetchPayrollInput, verifyEmployeeExists, HrmsUnavailableError,
} from "../../shared/hrms-client.js";
import * as commands from "./pay-group-commands.js";
import {
  countActiveRuns, countCurrentMembers, loadEmployeeAssignments, loadSettings, resolveMonthMembers,
} from "./pay-group-repo.js";
import {
  effectiveDateProblem, isIsoDate, membershipStatus, planAssignment, todayIst, MEMBERSHIP_REASON_MIN,
} from "./pay-group-domain.js";
import { isPayrollEligible } from "./domain.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES = [...PAYROLL_ROLES, "hr_admin", "finance_officer"];

const idParam = z.object({ id: z.string().uuid() });
const isoDate = z.string().refine(isIsoDate, "must be a valid YYYY-MM-DD date");
const reason = z.string().trim().min(MEMBERSHIP_REASON_MIN).max(500);

const assignBody = z.object({
  employeeId: z.string().uuid().optional(),
  employeeNo: z.string().trim().min(1).max(64).optional(),
  effectiveFrom: isoDate,
  reason,
}).refine((b) => (b.employeeId === undefined) !== (b.employeeNo === undefined), {
  message: "give exactly one of employeeId or employeeNo", path: ["employeeId"],
});

const endBody = z.object({ endsOn: isoDate, reason });

const bulkBody = z.object({
  effectiveFrom: isoDate,
  reason,
  rows: z.array(z.object({
    employeeId: z.string().uuid().optional(),
    employeeNo: z.string().trim().min(1).max(64).optional(),
  })).min(1).max(500),
});

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const membersQuery = pageQuery.extend({
  asOf: isoDate.optional(),
  history: z.enum(["true", "false"]).optional(),
});

const unassignedQuery = pageQuery.extend({ month: z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM").optional() });

type EmployeeSummary = { fullName: string; departmentName: string; employeeNo: string | null };

async function hrmsGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HrmsUnavailableError) throw new HttpError(502, "HRMS_UNAVAILABLE", "the employee directory is unavailable; try again shortly");
    throw err;
  }
}

async function loadGroupStatus(tenantId: string, id: string): Promise<{ status: string; name: string }> {
  const g = (await scopedRead((tx) => tx.execute(sql`
    SELECT status, name FROM payroll.pay_groups WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `))) as unknown as Array<{ status: string; name: string }>;
  if (!g[0]) throw new HttpError(404, "NOT_FOUND", "pay group not found");
  return g[0];
}

/** Run `fn` over `items` with bounded concurrency (hrms is called per item). */
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

const LOOKUP_CONCURRENCY = 8;
const IDS_PER_REQUEST = 40;

/**
 * employeeNo (case-insensitive) -> employee id, resolved with ONE filtered hrms
 * lookup per number, so it works on tenants far larger than the unfiltered
 * feed's 2000-row cap. Fails CLOSED when hrms is unavailable (a number that is
 * simply absent is not found; an outage is a 502).
 */
async function resolveEmployeeNumbers(tenantId: string, numbers: readonly string[]): Promise<Map<string, { id: string } & EmployeeSummary>> {
  const unique = [...new Set(numbers.map((n) => n.trim()))];
  const found = new Map<string, { id: string } & EmployeeSummary>();
  await hrmsGuard(() => mapBounded(unique, LOOKUP_CONCURRENCY, async (no) => {
    const hits = await searchEmployeeSummariesStrict(tenantId, { q: no });
    for (const [id, s] of hits) {
      if (s.employeeNo && s.employeeNo.trim().toLowerCase() === no.toLowerCase()) found.set(no.toLowerCase(), { id, ...s });
    }
  }));
  return found;
}

/** Display enrichment for known ids, chunked (fails open: a row then shows no name). */
async function summariesFor(tenantId: string, ids: readonly string[]): Promise<Map<string, EmployeeSummary>> {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) chunks.push(unique.slice(i, i + IDS_PER_REQUEST));
  const parts = await mapBounded(chunks, LOOKUP_CONCURRENCY, (c) => searchEmployeeSummaries(tenantId, { ids: c }));
  const out = new Map<string, EmployeeSummary>();
  for (const p of parts) for (const [k, v] of p) out.set(k, v);
  return out;
}

export async function payGroupMembershipRoutes(app: FastifyInstance): Promise<void> {
  // ─── tenant setting: may a membership change start mid-month? ─────────────
  app.get("/v1/payroll/pay-group-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send(await scopedRead((tx) => loadSettings(tx, ctx.tenantId)));
  });

  app.put("/v1/payroll/pay-group-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({ allowMidMonthEffective: z.boolean(), reason }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setPayGroupSettings(ctx, body));
  });

  // ─── employees in no pay group ────────────────────────────────────────────
  app.get("/v1/payroll/pay-groups/unassigned", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = unassignedQuery.parse(req.query);
    const month = q.month ?? todayIst().slice(0, 7);
    // The employees a regular run would pay (HRMS payroll feed, payroll-eligible
    // engagements only) that no assignment covers for the month. Fails closed
    // when HRMS is unreachable: an empty list would read as "everyone is assigned".
    const input = await hrmsGuard(() => fetchPayrollInput(ctx.tenantId, month));
    const { members, inactive } = await scopedRead(async (tx) => ({
      members: await resolveMonthMembers(tx, ctx.tenantId, month),
      inactive: new Set(((await tx.execute(sql`
        SELECT id::text AS id FROM payroll.pay_groups WHERE tenant_id = ${ctx.tenantId}::uuid AND status <> 'active'
      `)) as unknown as Array<{ id: string }>).map((r) => r.id)),
    }));
    // Unassigned = in no group, OR only in a deactivated group (no run can pay them).
    const missing = input.employees
      .filter((e) => isPayrollEligible(e as { paymentRoute?: string; eligibleForPayroll?: boolean })
        && (!members.has(e.id) || inactive.has(members.get(e.id)!)))
      .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo) || a.id.localeCompare(b.id));
    const page = missing.slice(q.offset, q.offset + q.limit);
    const summaries = await summariesFor(ctx.tenantId, page.map((e) => e.id));
    return reply.send({
      month,
      total: missing.length,
      limit: q.limit,
      offset: q.offset,
      data: page.map((e) => ({
        employeeId: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        departmentName: summaries.get(e.id)?.departmentName ?? null,
        reason: members.has(e.id) ? "inactive_group" : "no_group",
      })),
    });
  });

  // ─── detail ───────────────────────────────────────────────────────────────
  app.get("/v1/payroll/pay-groups/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const out = await scopedRead(async (tx) => {
      const g = (await tx.execute(sql`
        SELECT g.id, g.name, g.frequency, g.pay_day_of_month, g.pay_weekday, g.pay_last_day, g.pay_week_parity,
               g.timezone, g.status, g.created_at, g.ddo_code, g.bill_type, d.name AS ddo_name
          FROM payroll.pay_groups g
          LEFT JOIN payroll.payroll_ddos d ON d.tenant_id = g.tenant_id AND d.ddo_code = g.ddo_code
         WHERE g.id = ${id}::uuid AND g.tenant_id = ${ctx.tenantId}::uuid LIMIT 1
      `)) as unknown as Array<Record<string, unknown>>;
      if (!g[0]) return null;
      return {
        ...g[0],
        member_count: await countCurrentMembers(tx, ctx.tenantId, id, todayIst()),
        active_run_count: await countActiveRuns(tx, ctx.tenantId, id),
      };
    });
    if (!out) throw new HttpError(404, "NOT_FOUND", "pay group not found");
    return reply.send(out);
  });

  // ─── members (paged, with history on request) ─────────────────────────────
  app.get("/v1/payroll/pay-groups/:id/members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const q = membersQuery.parse(req.query);
    const asOf = q.asOf ?? todayIst();
    const history = q.history === "true";
    await loadGroupStatus(ctx.tenantId, id);
    const filter = history ? sql`` : sql`AND (a.effective_to IS NULL OR a.effective_to > ${asOf}::date)`;
    const { page, total } = await scopedRead(async (tx) => {
      const t = (await tx.execute(sql`
        SELECT COUNT(*)::text AS n FROM payroll.employee_pay_group_assignments a
         WHERE a.tenant_id = ${ctx.tenantId}::uuid AND a.pay_group_id = ${id}::uuid ${filter}
      `)) as unknown as Array<{ n: string }>;
      const p = (await tx.execute(sql`
        SELECT a.id, a.employee_id, a.effective_from::text AS effective_from, a.effective_to::text AS effective_to, a.reason
          FROM payroll.employee_pay_group_assignments a
         WHERE a.tenant_id = ${ctx.tenantId}::uuid AND a.pay_group_id = ${id}::uuid ${filter}
         ORDER BY a.effective_from DESC, a.employee_id
         LIMIT ${q.limit} OFFSET ${q.offset}
      `)) as unknown as Array<{ id: string; employee_id: string; effective_from: string; effective_to: string | null; reason: string | null }>;
      return { page: p, total: Number(t[0]?.n ?? 0) };
    });
    // Names are display enrichment (fails open: a row then shows no name, never a raw id).
    const summaries = await summariesFor(ctx.tenantId, page.map((r) => r.employee_id));
    return reply.send({
      data: page.map((r) => {
        const s = summaries.get(r.employee_id);
        return {
          assignmentId: r.id,
          employeeId: r.employee_id,
          employeeNo: s?.employeeNo ?? null,
          fullName: s?.fullName ?? null,
          departmentName: s?.departmentName ?? null,
          effectiveFrom: r.effective_from,
          effectiveTo: r.effective_to,
          status: membershipStatus(r.effective_from, r.effective_to, asOf),
          reason: r.reason,
        };
      }),
      total, limit: q.limit, offset: q.offset,
    });
  });

  // ─── assign / move one employee ───────────────────────────────────────────
  app.post("/v1/payroll/pay-groups/:id/members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const settings = await scopedRead((tx) => loadSettings(tx, ctx.tenantId));
    const dateProblem = effectiveDateProblem(body.effectiveFrom, settings.allowMidMonthEffective);
    if (dateProblem === "EFFECTIVE_DATE_NOT_MONTH_START") {
      throw new HttpError(400, "EFFECTIVE_DATE_NOT_MONTH_START", "a pay-group change takes effect from the 1st of a month");
    }
    if (dateProblem) throw new HttpError(400, "INVALID_DATE", "effectiveFrom is not a valid date");
    const group = await loadGroupStatus(ctx.tenantId, id);
    if (group.status !== "active") throw new HttpError(409, "PAY_GROUP_INACTIVE", `pay group ${group.name} is deactivated`);

    let employeeId = body.employeeId;
    if (employeeId) {
      if (!(await hrmsGuard(() => verifyEmployeeExists(ctx.tenantId, employeeId!)))) {
        throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "no such employee");
      }
    } else {
      employeeId = (await resolveEmployeeNumbers(ctx.tenantId, [body.employeeNo!])).get(body.employeeNo!.trim().toLowerCase())?.id;
      if (!employeeId) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", `no employee with number ${body.employeeNo}`);
    }
    const existing = await scopedRead((tx) => loadEmployeeAssignments(tx, ctx.tenantId, employeeId!));
    const plan = planAssignment(existing, id, body.effectiveFrom);
    if (plan.kind === "unchanged") throw new HttpError(409, "ALREADY_MEMBER", "the employee is already a member of this pay group on that date");
    if (plan.kind === "reject") throw new HttpError(409, plan.code, plan.message);
    const accepted = await commands.assignPayGroupMember(ctx, { payGroupId: id, employeeId, effectiveFrom: body.effectiveFrom, reason: body.reason });
    return sendAccepted(reply, acceptedResponseSchema, { ...accepted, data: { id, action: plan.kind === "move" ? "move" : "assign" } });
  });

  // ─── end a membership ─────────────────────────────────────────────────────
  app.post("/v1/payroll/pay-groups/:id/members/:employeeId/end", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id, employeeId } = z.object({ id: z.string().uuid(), employeeId: z.string().uuid() }).parse(req.params);
    const body = endBody.parse(req.body);
    const settings = await scopedRead((tx) => loadSettings(tx, ctx.tenantId));
    const dateProblem = effectiveDateProblem(body.endsOn, settings.allowMidMonthEffective);
    if (dateProblem === "EFFECTIVE_DATE_NOT_MONTH_START") {
      throw new HttpError(400, "EFFECTIVE_DATE_NOT_MONTH_START", "a pay-group change takes effect from the 1st of a month");
    }
    if (dateProblem) throw new HttpError(400, "INVALID_DATE", "endsOn is not a valid date");
    await loadGroupStatus(ctx.tenantId, id);
    const existing = await scopedRead((tx) => loadEmployeeAssignments(tx, ctx.tenantId, employeeId));
    const open = existing.find((a) => a.payGroupId === id && a.effectiveTo === null);
    if (!open) throw new HttpError(409, "NOT_A_MEMBER", "the employee has no open membership of this pay group");
    if (body.endsOn <= open.effectiveFrom) {
      throw new HttpError(400, "INVALID_END_DATE", `the end date must be after the membership start (${open.effectiveFrom})`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.endPayGroupMember(ctx, { payGroupId: id, employeeId, endsOn: body.endsOn, reason: body.reason }));
  });

  // ─── bulk assign: per-row validation, ONE command + ONE audit event ───────
  app.post("/v1/payroll/pay-groups/:id/members/bulk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = bulkBody.parse(req.body);
    const settings = await scopedRead((tx) => loadSettings(tx, ctx.tenantId));
    const dateProblem = effectiveDateProblem(body.effectiveFrom, settings.allowMidMonthEffective);
    if (dateProblem === "EFFECTIVE_DATE_NOT_MONTH_START") {
      throw new HttpError(400, "EFFECTIVE_DATE_NOT_MONTH_START", "a pay-group change takes effect from the 1st of a month");
    }
    if (dateProblem) throw new HttpError(400, "INVALID_DATE", "effectiveFrom is not a valid date");
    const group = await loadGroupStatus(ctx.tenantId, id);
    if (group.status !== "active") throw new HttpError(409, "PAY_GROUP_INACTIVE", `pay group ${group.name} is deactivated`);

    // Resolve every number / id with filtered lookups (bounded, batched), never the
    // 2000-row-capped unfiltered feed. An hrms outage is a 502, not "not found".
    const byNo = await resolveEmployeeNumbers(ctx.tenantId, body.rows.flatMap((r) => (r.employeeNo ? [r.employeeNo] : [])));
    const rowIds = [...new Set(body.rows.flatMap((r) => (r.employeeId ? [r.employeeId] : [])))];
    const idExists = new Map<string, boolean>();
    await hrmsGuard(() => mapBounded(rowIds, LOOKUP_CONCURRENCY, async (eid) => { idExists.set(eid, await verifyEmployeeExists(ctx.tenantId, eid)); }));
    const summaries = new Map<string, EmployeeSummary>();
    for (const v of byNo.values()) summaries.set(v.id, v);

    type Rejected = { row: number; employeeNo: string | null; code: string; message: string };
    const rejected: Rejected[] = [];
    const accepted: string[] = [];
    const seen = new Set<string>();
    for (const [row, r] of body.rows.entries()) {
      const label = r.employeeNo ?? null;
      if ((r.employeeId === undefined) === (r.employeeNo === undefined)) {
        rejected.push({ row, employeeNo: label, code: "ROW_INVALID", message: "give exactly one of employeeId or employeeNo" });
        continue;
      }
      const employeeId = r.employeeId ?? byNo.get(r.employeeNo!.trim().toLowerCase())?.id;
      if (!employeeId || (r.employeeId ? idExists.get(employeeId) !== true : !summaries.has(employeeId))) {
        rejected.push({ row, employeeNo: label, code: "EMPLOYEE_NOT_FOUND", message: "no such employee" });
        continue;
      }
      if (seen.has(employeeId)) {
        rejected.push({ row, employeeNo: label ?? summaries.get(employeeId)?.employeeNo ?? null, code: "DUPLICATE_ROW", message: "the employee appears more than once in this batch" });
        continue;
      }
      seen.add(employeeId);
      const existing = await scopedRead((tx) => loadEmployeeAssignments(tx, ctx.tenantId, employeeId));
      const plan = planAssignment(existing, id, body.effectiveFrom);
      if (plan.kind === "unchanged") {
        rejected.push({ row, employeeNo: label ?? summaries.get(employeeId)?.employeeNo ?? null, code: "ALREADY_MEMBER", message: "already a member of this pay group on that date" });
        continue;
      }
      if (plan.kind === "reject") {
        rejected.push({ row, employeeNo: label ?? summaries.get(employeeId)?.employeeNo ?? null, code: plan.code, message: plan.message });
        continue;
      }
      accepted.push(employeeId);
    }
    if (accepted.length === 0) {
      return reply.code(422).send({
        code: "BULK_NOTHING_TO_ASSIGN", message: "none of the rows can be assigned",
        details: { rejected },
      });
    }
    const result = await commands.bulkAssignPayGroupMembers(ctx, {
      payGroupId: id, employeeIds: accepted, effectiveFrom: body.effectiveFrom, reason: body.reason,
    });
    return sendAccepted(reply, acceptedResponseSchema, {
      id: result.id, status: "accepted", correlationId: result.correlationId,
      data: { id: result.id, batchId: result.batchId, accepted: accepted.length, rejected },
    });
  });

  // ─── an employee's pay group (profile pay section) ────────────────────────
  app.get("/v1/payroll/employees/:employeeId/pay-group", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid() }).parse(req.params);
    const today = todayIst();
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT a.pay_group_id, g.name AS pay_group_name, g.ddo_code, g.bill_type,
             a.effective_from::text AS effective_from, a.effective_to::text AS effective_to, a.reason
        FROM payroll.employee_pay_group_assignments a
        JOIN payroll.pay_groups g ON g.id = a.pay_group_id AND g.tenant_id = a.tenant_id
       WHERE a.tenant_id = ${ctx.tenantId}::uuid AND a.employee_id = ${employeeId}::uuid
       ORDER BY a.effective_from DESC LIMIT 100
    `))) as unknown as Array<{
      pay_group_id: string; pay_group_name: string; ddo_code: string | null; bill_type: string;
      effective_from: string; effective_to: string | null; reason: string | null;
    }>;
    const shape = (r: (typeof rows)[number]) => ({
      payGroupId: r.pay_group_id, payGroupName: r.pay_group_name, ddoCode: r.ddo_code, billType: r.bill_type,
      effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    });
    const cur = rows.find((r) => membershipStatus(r.effective_from, r.effective_to, today) === "current");
    return reply.send({
      current: cur ? shape(cur) : null,
      history: rows.map((r) => ({ ...shape(r), reason: r.reason })),
    });
  });
}
