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
  updateProjectBody, updateTaskBody, addMemberBody, memberParam, listTasksQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import * as queries from "./queries.js";

const PROJ_ROLES   = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];

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
    // idempotency: check if user already a member
    const existing = await repo.findMemberByUserAndProject(id, body.userId, ctx.tenantId);
    if (existing) {
      return reply.code(409).send({ code: "CONFLICT", message: "user is already a member of this project" });
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.addMember(ctx, id, body));
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
