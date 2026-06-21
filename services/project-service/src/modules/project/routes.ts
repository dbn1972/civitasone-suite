import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
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
} from "./validators.js";
import * as commands from "./commands.js";
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
    const tenantId = q.tenantId ?? ctx.tenantId;
    return reply.send(await queries.listProjects(tenantId, q.status, q.page, q.limit));
  });

  app.get("/v1/projects/projects", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listProjectsQuery.parse(req.query);
    sendValidated(reply, ProjectSummaryListSchema, await queries.listProjectSummaries(q.tenantId ?? ctx.tenantId, q.limit));
  });

  app.get("/v1/projects/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 100), 200);
    sendValidated(reply, MilestoneSummaryListSchema, await queries.listMilestoneSummaries(ctx.tenantId, limit));
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
