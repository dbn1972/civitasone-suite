import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { analyzeGaps, mergeLevel } from "./domain.js";
import {
  createFrameworkBody, createCompetencyBody, roleRequirementBody, setEmployeeCompetencyBody,
} from "./validators.js";
import * as repo from "./repo.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];
const idParam = z.object({ id: z.string().uuid() });

export async function competencyRoutes(app: FastifyInstance): Promise<void> {
  // ── Framework / dictionary ──────────────────────────────────────
  app.post("/v1/hrms/competency/frameworks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createFrameworkBody.parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "competency_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "active" });
  });

  app.get("/v1/hrms/competency/frameworks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send(await repo.listFrameworks(ctx.tenantId));
  });

  app.post("/v1/hrms/competency/frameworks/:id/competencies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createCompetencyBody.parse(req.body);
    const fw = await repo.getFramework(ctx.tenantId, id);
    if (!fw) throw new HttpError(404, "NOT_FOUND", "framework not found");
    const cid = randomUUID();
    const row = await publishF3Write(ctx, "competency_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: row.id, code: row.code });
  });

  app.get("/v1/hrms/competency/competencies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send(await repo.listCompetencies(ctx.tenantId));
  });

  // ── Role → required competencies → proficiency levels ───────────
  app.post("/v1/hrms/competency/role-requirements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = roleRequirementBody.parse(req.body);
    const comp = await repo.getCompetency(ctx.tenantId, body.competencyId);
    if (!comp) throw new HttpError(404, "NOT_FOUND", "competency not found");
    await publishF3Write(ctx, "competency_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ roleCode: body.roleCode, competencyId: body.competencyId, requiredLevel: body.requiredLevel });
  });

  app.get("/v1/hrms/competency/roles/:roleCode/requirements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { roleCode } = z.object({ roleCode: z.string().min(1).max(64) }).parse(req.params);
    return reply.send(await repo.listRoleRequirements(ctx.tenantId, roleCode));
  });

  // ── Employee competency profile ─────────────────────────────────
  app.put("/v1/hrms/competency/employees/:id/competencies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = setEmployeeCompetencyBody.parse(req.body);
    const comp = await repo.getCompetency(ctx.tenantId, body.competencyId);
    if (!comp) throw new HttpError(404, "NOT_FOUND", "competency not found");
    const level = Math.min(body.currentLevel, comp.maxLevel);
    await publishF3Write(ctx, "competency_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ employeeId: id, competencyId: body.competencyId, currentLevel: mergeLevel(0, level) });
  });

  app.get("/v1/hrms/competency/employees/:id/profile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await repo.listEmployeeCompetencies(ctx.tenantId, id));
  });

  // ── Gap analysis (required for role vs held) ────────────────────
  app.get("/v1/hrms/competency/gap-analysis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { employeeId, roleCode } = z.object({
      employeeId: z.string().uuid(),
      roleCode:   z.string().min(1).max(64),
    }).parse(req.query);
    const [required, held] = await Promise.all([
      repo.listRoleRequirements(ctx.tenantId, roleCode),
      repo.listEmployeeCompetencies(ctx.tenantId, employeeId),
    ]);
    const heldMap = new Map(held.map((h) => [h.competencyId, h.currentLevel]));
    const analysis = analyzeGaps(
      required.map((r) => ({ competencyId: r.competencyId, requiredLevel: r.requiredLevel })),
      heldMap,
    );
    return reply.send({ employeeId, roleCode, ...analysis });
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
