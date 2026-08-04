/**
 * LQ-001 — lead qualification framework routes.
 *
 *   GET    /v1/crm/qualification-frameworks           — list (optional ?businessLine=, ?active=)
 *   GET    /v1/crm/qualification-frameworks/:id        — one framework + its questions
 *   POST   /v1/crm/qualification-frameworks           — create (admin)
 *   PUT    /v1/crm/qualification-frameworks/:id        — update, replaces questions (admin)
 *   DELETE /v1/crm/qualification-frameworks/:id        — delete (admin)
 *   POST   /v1/crm/leads/:id/qualify                   — score a lead against a framework
 *   GET    /v1/crm/leads/:id/qualifications            — prior qualification results
 *
 * Framework CRUD is synchronous + transactionally audited (the dedup-rules pattern);
 * the qualify submission is async CQRS (route computes outcome, consumer persists).
 */
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { contacts } from "../contacts/schema.js";
import * as repo from "./qualification-repo.js";
import * as commands from "./qualification-commands.js";
import { computeQualification, type QualificationQuestion } from "./qualification-domain.js";
import {
  createFrameworkBody,
  updateFrameworkBody,
  listFrameworksQuery,
  qualifyBody,
  frameworkIdParam,
  leadIdParam,
} from "./qualification-validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

async function leadExists(tenantId: string, leadId: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.id, leadId), eq(contacts.tenantId, tenantId), sql`${contacts.status} = 'active'`))
    .limit(1));
  return rows.length > 0;
}

export async function qualificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/qualification-frameworks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listFrameworksQuery.parse(req.query);
    const frameworks = await repo.listFrameworks(ctx.tenantId, {
      ...(q.businessLine ? { businessLine: q.businessLine } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
    });
    return reply.send({ data: frameworks, meta: { total: frameworks.length } });
  });

  app.get("/v1/crm/qualification-frameworks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = frameworkIdParam.parse(req.params);
    const framework = await repo.getFramework(ctx.tenantId, id);
    if (!framework) throw new HttpError(404, "NOT_FOUND", "framework not found");
    return reply.send({ data: framework });
  });

  app.post("/v1/crm/qualification-frameworks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createFrameworkBody.parse(req.body);
    const framework = await repo.createFramework(ctx.tenantId, ctx.actorId, ctx.correlationId, body);
    return reply.code(201).send({ data: framework });
  });

  app.put("/v1/crm/qualification-frameworks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = frameworkIdParam.parse(req.params);
    const body = updateFrameworkBody.parse(req.body);
    const framework = await repo.updateFramework(ctx.tenantId, ctx.actorId, ctx.correlationId, id, body);
    if (!framework) throw new HttpError(404, "NOT_FOUND", "framework not found");
    return reply.send({ data: framework });
  });

  app.delete("/v1/crm/qualification-frameworks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = frameworkIdParam.parse(req.params);
    const deleted = await repo.deleteFramework(ctx.tenantId, ctx.actorId, ctx.correlationId, id);
    if (!deleted) throw new HttpError(404, "NOT_FOUND", "framework not found");
    return reply.send({ data: { id, deleted: true } });
  });

  app.post("/v1/crm/leads/:id/qualify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = leadIdParam.parse(req.params);
    const body = qualifyBody.parse(req.body);

    if (!(await leadExists(ctx.tenantId, id))) {
      throw new HttpError(404, "NOT_FOUND", "lead not found");
    }
    const framework = await repo.getFramework(ctx.tenantId, body.frameworkId);
    if (!framework) throw new HttpError(404, "NOT_FOUND", "framework not found");
    if (!framework.active) throw new HttpError(422, "FRAMEWORK_INACTIVE", "framework is not active");

    const questions: QualificationQuestion[] = framework.questions.map((q) => ({
      id: q.id,
      answerType: q.answerType as QualificationQuestion["answerType"],
      weight: q.weight,
      outcomeRule: q.outcomeRule,
      order: q.order,
    }));
    const result = computeQualification(questions, body.answers);

    const accepted = await commands.qualifyLead(ctx, {
      leadId: id,
      frameworkId: body.frameworkId,
      answers: body.answers,
      outcome: result.outcome,
      score: result.score,
      factors: result.factors,
    });
    return reply.code(202).send(accepted);
  });

  app.get("/v1/crm/leads/:id/qualifications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = leadIdParam.parse(req.params);
    const data = await repo.listLeadQualifications(ctx.tenantId, id);
    return reply.send({ data, meta: { total: data.length } });
  });
}
