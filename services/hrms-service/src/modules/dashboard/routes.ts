import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HRDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { z } from "zod";
import * as queries from "./queries.js";
import type { RequestContext } from "@civitasone/types";
import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import { getPolicy } from "../policy-settings/repo.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

const PendingLeaveInboxItemSchema = z.object({
  id: z.string(),
  employeeName: z.string(),
  employeeNo: z.string(),
  departmentName: z.string(),
  leaveTypeName: z.string(),
  leaveTypeCode: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  daysApplied: z.number(),
  status: z.string(),
});
// `routingFailed` is additive/optional on purpose: it's a NEW sibling array
// (leave applications whose workflow instance came back rejected — see
// leave/consumer.ts's WORKFLOW_INSTANCE_REJECTED subscriber), not something
// existing callers of this endpoint know to send, so a `.default([])`
// keeps this schema backward compatible.
const PendingLeaveInboxSchema = z.object({
  data: z.array(PendingLeaveInboxItemSchema),
  routingFailed: z.array(PendingLeaveInboxItemSchema).default([]),
});

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

/**
 * GAP-HR-DASHBOARD-08: a viewer whose only elevated role is `manager` sees the
 * dashboard for their direct reports (the same set their employee list is
 * already limited to) under the default `dashboard_scope` policy; a tenant can
 * switch that to 'organisation' (tenant-wide, labelled as such on the page).
 * HR roles are never scoped. Returns the report ids, or undefined for
 * "tenant-wide". An unresolvable manager gets [] (empty, never tenant-wide).
 */
export async function resolveDashboardScope(ctx: RequestContext): Promise<string[] | undefined> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) return undefined;
  if (!ctx.roles.includes("manager")) return undefined;
  const policy = await getPolicy(ctx.tenantId, "dashboard_scope");
  if (policy.managerScope === "organisation") return undefined;
  const self = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!self) return [];
  const reports = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.managerId, self.id))));
  return reports.map((r) => r.id);
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const scope = await resolveDashboardScope(ctx);
    const data = await queries.getDashboard(ctx.tenantId, scope);
    // `scope` tells the page what it is showing, so the label never lies.
    sendValidated(reply, HRDashboardSchema, { ...data, scope: scope ? "direct_reports" : "organisation" });
  });

  app.get("/v1/hrms/dashboard/pending-leaves", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const scope = await resolveDashboardScope(ctx);
    const [items, routingFailed] = await Promise.all([
      queries.getPendingLeaveInbox(ctx.tenantId, scope),
      queries.getRoutingFailedLeaveInbox(ctx.tenantId, scope),
    ]);
    sendValidated(reply, PendingLeaveInboxSchema, { data: items, routingFailed });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) { return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) }); }
    if (err instanceof HttpError) { return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false }); }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
