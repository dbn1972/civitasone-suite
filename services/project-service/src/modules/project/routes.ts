import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import {
  ProjectSummaryListSchema,
  ProjectDetailSchema,
  MilestoneSummaryListSchema,
} from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createProjectBody, createTaskBody, updateTaskStatusBody, createMilestoneBody,
  idParam, taskParam, milestoneParam, listProjectsQuery,
  updateProjectBody, updateTaskBody, addMemberBody, changeMemberRoleBody, memberParam, listTasksQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import * as queries from "./queries.js";
import { assertTaskTransitionAllowed, DomainError } from "./domain.js";
import { verifyEmployeeExists, HrmsUnavailableError } from "../../shared/hrms-client.js";

const PROJ_ROLES   = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];

/**
 * Only the project's existing manager (a member with role project_manager) or a super admin may appoint
 * or change a project manager, and nobody may do it to themselves.
 */
async function assertMayAppointManager(ctx: ReturnType<typeof resolveContext>, projectId: string, targetUserId: string | undefined): Promise<void> {
  if (targetUserId && targetUserId === ctx.actorId) {
    throw new HttpError(403, "SELF_ROLE_CHANGE", "nobody can give themselves the project manager role");
  }
  if (ctx.roles.includes("super_admin")) return;
  const me = await repo.findMemberByUserAndProject(projectId, ctx.actorId, ctx.tenantId);
  if (me?.role !== "project_manager") {
    throw new HttpError(403, "MANAGER_GRANT_FORBIDDEN", "only this project's manager or a super admin can appoint or change a project manager");
  }
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/projects", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const body = createProjectBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createProject(ctx, body));
  });

  app.get("/v1/projects", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listProjectsQuery.parse(req.query);
    // SECURITY: always derive tenant from auth context; never trust client-supplied tenantId.
    return reply.send(await queries.listProjects(ctx.tenantId, q.status, q.page, q.limit));
  });

  app.get("/v1/projects/projects", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listProjectsQuery.parse(req.query);
    sendValidated(reply, ProjectSummaryListSchema, await queries.listProjectSummaries(ctx.tenantId, q.limit));
  });

  app.get("/v1/projects/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, MilestoneSummaryListSchema, await queries.listMilestoneSummaries(ctx.tenantId, q.limit));
  });

  app.get("/v1/projects/projects/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const project = await queries.getProjectDetail(id, ctx.tenantId);
    if (!project) throw new HttpError(404, "NOT_FOUND", "project not found");
    sendValidated(reply, ProjectDetailSchema, project);
  });

  app.get("/v1/projects/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const project = await queries.getProject(id, ctx.tenantId);
    if (!project) throw new HttpError(404, "NOT_FOUND", "project not found");
    return reply.send(project);
  });

  app.post("/v1/projects/:id/tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createTaskBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTask(ctx, id, body));
  });

  app.patch("/v1/projects/:id/tasks/:taskId/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, taskId } = taskParam.parse(req.params);
    const body = updateTaskStatusBody.parse(req.body);
    // GAP-PROJECTS-DETAIL-TASKS-01: refuse synchronously what the consumer would
    // only reject later: a task that is not in THIS project (ownership) or an
    // illegal status transition, so the UI gets a clear 404/422 instead of a
    // silent 202 that never applies.
    const task = await repo.findTaskById(taskId, ctx.tenantId);
    if (!task || task.projectId !== id) throw new HttpError(404, "NOT_FOUND", "task not found");
    try {
      assertTaskTransitionAllowed(task.status ?? "pending", body.status);
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(422, "INVALID_TRANSITION", err.message);
      throw err;
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTaskStatus(ctx, id, taskId, body));
  });

  app.post("/v1/projects/:id/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createMilestoneBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createMilestone(ctx, id, body));
  });

  app.patch("/v1/projects/:id/milestones/:mId/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, mId } = milestoneParam.parse(req.params);
    // UAT W6-A: the milestone must exist in THIS project (tenant-scoped); else 404, not 202.
    const milestone = await repo.findMilestoneById(mId, ctx.tenantId);
    if (!milestone || milestone.projectId !== id) throw new HttpError(404, "NOT_FOUND", "milestone not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeMilestone(ctx, id, mId));
  });


  // ─── Update project ──────────────────────────────────────────────────────────

  app.patch("/v1/projects/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateProjectBody.parse(req.body);
    // Synchronous pre-accept existence/tenant check — without this, a PATCH
    // for a nonexistent or cross-tenant project id was silently accepted
    // (202) and queued, then no-oped in the async consumer with no channel
    // back to the caller. Mirrors the findProjectById guard used by GET
    // /gantt above.
    const existing = await repo.findProjectById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "project not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateProject(ctx, id, body));
  });

  // ─── List tasks for a project ─────────────────────────────────────────────

  app.get("/v1/projects/:id/tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listTasksQuery.parse(req.query);
    const tasks = await repo.listTasksByProject(id, ctx.tenantId);
    const filtered = q.status ? tasks.filter((t) => t.status === q.status) : tasks;
    return reply.send({ data: filtered.slice(0, q.limit) });
  });

  // ─── Update task (full, not just status) ─────────────────────────────────

  app.patch("/v1/projects/:id/tasks/:taskId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, taskId } = taskParam.parse(req.params);
    const body = updateTaskBody.parse(req.body);
    // UAT W6-A: same ownership guard as PATCH .../status: the task must exist in THIS project.
    const task = await repo.findTaskById(taskId, ctx.tenantId);
    if (!task || task.projectId !== id) throw new HttpError(404, "NOT_FOUND", "task not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTask(ctx, id, taskId, body));
  });

  // ─── Milestones per project ───────────────────────────────────────────────

  app.get("/v1/projects/:id/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const milestones = await repo.listMilestonesByProject(id, ctx.tenantId);
    return reply.send({
      data: milestones.map((m) => ({
        id: m.id,
        projectId: m.projectId,
        name: m.name,
        plannedDate: m.plannedDate?.toString(),
        actualDate: m.actualDate?.toString(),
        paymentMinor: m.paymentMinor?.toString(),
        status: m.status,
        createdAt: m.createdAt,
      })),
    });
  });

  // ─── Gantt data (tasks with planned/actual dates) ─────────────────────────

  app.get("/v1/projects/:id/gantt", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const [tasks, milestones, project] = await Promise.all([
      repo.listTasksByProject(id, ctx.tenantId),
      repo.listMilestonesByProject(id, ctx.tenantId),
      repo.findProjectById(id, ctx.tenantId),
    ]);
    if (!project) throw new HttpError(404, "NOT_FOUND", "project not found");
    return reply.send({
      projectId: id,
      projectName: project.name,
      startDate: project.startDate?.toString(),
      endDate: project.endDate?.toString(),
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        parentTaskId: t.parentTaskId,
        status: t.status,
        progressPct: Number(t.progressPct),
        plannedStart: t.plannedStart?.toString(),
        plannedEnd: t.plannedEnd?.toString(),
        actualStart: t.actualStart?.toString(),
        actualEnd: t.actualEnd?.toString(),
        weightPct: Number(t.weightPct),
      })),
      milestones: milestones.map((m) => ({
        id: m.id,
        name: m.name,
        plannedDate: m.plannedDate?.toString(),
        actualDate: m.actualDate?.toString(),
        status: m.status,
      })),
    });
  });

  // ─── Project Members ──────────────────────────────────────────────────────

  app.get("/v1/projects/:id/members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const members = await repo.listMembersByProject(id, ctx.tenantId);
    return reply.send({ data: members });
  });

  app.post("/v1/projects/:id/members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = addMemberBody.parse(req.body);
    // Appointing a project manager is how a person gets the project's cost totals (staff-cost), so it is
    // not open to every project officer: only this project's existing manager or a super admin may do it,
    // and nobody may give THEMSELVES the role.
    if (body.role === "project_manager") await assertMayAppointManager(ctx, id, body.userId);
    // idempotency: check if the user / employee is already a member
    if (body.userId) {
      const existing = await repo.findMemberByUserAndProject(id, body.userId, ctx.tenantId);
      if (existing) {
        return reply.code(409).send({ code: "CONFLICT", message: "user is already a member of this project" });
      }
    }
    if (body.employeeId) {
      // S8 G7: employee membership (with or without a login). The id is a soft cross-service
      // reference, so HRMS is asked; an unreachable HRMS is a 503, never a silent accept.
      try {
        if (!(await verifyEmployeeExists(ctx.tenantId, body.employeeId))) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "employee not found");
      } catch (err) {
        if (err instanceof HrmsUnavailableError) throw new HttpError(503, "HRMS_UNAVAILABLE", "could not verify the employee; try again");
        throw err;
      }
      const existing = await repo.findMemberByEmployeeAndProject(id, body.employeeId, ctx.tenantId);
      if (existing) {
        return reply.code(409).send({ code: "CONFLICT", message: "employee is already a member of this project" });
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.addMember(ctx, id, body));
  });

  app.patch("/v1/projects/:id/members/:memberId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, memberId } = memberParam.parse(req.params);
    const body = changeMemberRoleBody.parse(req.body);
    const member = await repo.findMemberById(memberId, ctx.tenantId);
    if (!member || member.projectId !== id) throw new HttpError(404, "NOT_FOUND", "member not found");
    if (member.userId && member.userId === ctx.actorId) {
      throw new HttpError(403, "SELF_ROLE_CHANGE", "you cannot change your own role on a project");
    }
    if (body.role === "project_manager" && !member.userId) {
      throw new HttpError(400, "VALIDATION_ERROR", "a member without a login cannot be the project manager");
    }
    // changing a manager's role, or making someone a manager, is a manager / super admin decision
    if (body.role === "project_manager" || member.role === "project_manager") await assertMayAppointManager(ctx, id, member.userId ?? undefined);
    return sendAccepted(reply, acceptedResponseSchema, await commands.changeMemberRole(ctx, id, memberId, body.role));
  });

  app.delete("/v1/projects/:id/members/:memberId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, memberId } = memberParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.removeMember(ctx, id, memberId));
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
