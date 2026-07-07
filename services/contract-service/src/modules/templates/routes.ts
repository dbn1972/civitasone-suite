import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createTemplateBody,
  updateTemplateBody,
  templateIdParam,
  templateListQuery,
  deleteTemplateBody,
  addClauseBody,
  updateClauseBody,
  templateClauseParams,
  renderQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { MAX_CLAUSES_PER_TEMPLATE } from "./domain.js";
import { renderTemplateClauses } from "./domain.js";
import { clauseLibrary } from "../clauses/schema.js";
import { db } from "../../shared/db.js";
import { eq, and, inArray, sql } from "drizzle-orm";

const TEMPLATE_WRITE_ROLES = ["super_admin", "legal_officer", "contract_admin", "procurement_admin"];
const TEMPLATE_READ_ROLES = [...TEMPLATE_WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  // ── Create template ─────────────────────────────────────────────────────
  app.post("/v1/contract/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_WRITE_ROLES);
    const body = createTemplateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTemplate(ctx, body));
  });

  // ── List templates ──────────────────────────────────────────────────────
  app.get("/v1/contract/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_READ_ROLES);
    const q = templateListQuery.parse(req.query);
    const opts: { limit: number; offset: number; status?: string } = {
      limit: q.limit,
      offset: q.offset,
    };
    if (q.status) opts.status = q.status;
    const { data, total } = await queries.listTemplates(ctx.tenantId, opts);
    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── Get single template ─────────────────────────────────────────────────
  app.get("/v1/contract/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_READ_ROLES);
    const { id } = templateIdParam.parse(req.params);
    const template = await queries.getTemplate(id, ctx.tenantId);
    if (!template) throw new HttpError(404, "NOT_FOUND", "template not found");
    const clauses = await queries.getTemplateClauses(id, ctx.tenantId);
    return reply.send({ data: { ...template, clauses } });
  });

  // ── Update template ─────────────────────────────────────────────────────
  app.patch("/v1/contract/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_WRITE_ROLES);
    const { id } = templateIdParam.parse(req.params);
    const body = updateTemplateBody.parse(req.body);

    const existing = await queries.getTemplate(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "template not found");
    if (existing.status === "archived") throw new HttpError(409, "ARCHIVED", "cannot update archived template");
    if (existing.version !== body.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "template has been modified by another user");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTemplate(ctx, id, body));
  });

  // ── Delete (archive) template ───────────────────────────────────────────
  app.delete("/v1/contract/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_WRITE_ROLES);
    const { id } = templateIdParam.parse(req.params);
    const body = deleteTemplateBody.parse(req.body);

    const existing = await queries.getTemplate(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "template not found");
    if (existing.status === "archived") throw new HttpError(409, "ALREADY_ARCHIVED", "template is already archived");
    if (existing.version !== body.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "template has been modified by another user");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteTemplate(ctx, id, body.version));
  });

  // ── Add clause to template ──────────────────────────────────────────────
  app.post("/v1/contract/templates/:id/clauses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_WRITE_ROLES);
    const { id } = templateIdParam.parse(req.params);
    const body = addClauseBody.parse(req.body);

    const template = await queries.getTemplate(id, ctx.tenantId);
    if (!template) throw new HttpError(404, "NOT_FOUND", "template not found");
    if (template.status === "archived") throw new HttpError(409, "ARCHIVED", "cannot modify archived template");

    // Enforce max 200 clauses per template
    const count = await queries.countTemplateClauses(id, ctx.tenantId);
    if (count >= MAX_CLAUSES_PER_TEMPLATE) {
      throw new HttpError(422, "CLAUSE_LIMIT_REACHED", `maximum ${MAX_CLAUSES_PER_TEMPLATE} clauses per template reached`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.addClauseToTemplate(ctx, id, body));
  });

  // ── Update clause in template (rank/condition) ──────────────────────────
  app.patch("/v1/contract/templates/:id/clauses/:clauseId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_WRITE_ROLES);
    const { id, clauseId } = templateClauseParams.parse(req.params);
    const body = updateClauseBody.parse(req.body);

    const template = await queries.getTemplate(id, ctx.tenantId);
    if (!template) throw new HttpError(404, "NOT_FOUND", "template not found");
    if (template.status === "archived") throw new HttpError(409, "ARCHIVED", "cannot modify archived template");

    const clause = await queries.getTemplateClause(id, clauseId, ctx.tenantId);
    if (!clause) throw new HttpError(404, "NOT_FOUND", "template clause not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTemplateClause(ctx, id, clauseId, body));
  });

  // ── Remove clause from template ────────────────────────────────────────
  app.delete("/v1/contract/templates/:id/clauses/:clauseId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_WRITE_ROLES);
    const { id, clauseId } = templateClauseParams.parse(req.params);

    const template = await queries.getTemplate(id, ctx.tenantId);
    if (!template) throw new HttpError(404, "NOT_FOUND", "template not found");
    if (template.status === "archived") throw new HttpError(409, "ARCHIVED", "cannot modify archived template");

    const clause = await queries.getTemplateClause(id, clauseId, ctx.tenantId);
    if (!clause) throw new HttpError(404, "NOT_FOUND", "template clause not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.removeTemplateClause(ctx, id, clauseId));
  });

  // ── Render template (apply conditions, return clauses in rank order) ────
  app.get("/v1/contract/templates/:id/render", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_READ_ROLES);
    const { id } = templateIdParam.parse(req.params);

    const template = await queries.getTemplate(id, ctx.tenantId);
    if (!template) throw new HttpError(404, "NOT_FOUND", "template not found");

    // Parse metadata from query string (JSON-encoded)
    const metadataRaw = (req.query as Record<string, unknown>).metadata;
    const metadata: Record<string, unknown> = metadataRaw
      ? JSON.parse(String(metadataRaw))
      : {};

    const allClauses = await queries.getTemplateClauses(id, ctx.tenantId);

    // Apply conditions and sort by rank
    const rendered = renderTemplateClauses(allClauses, metadata);

    // Fetch clause bodies for rendered clauses
    const clauseIds = rendered.map((c) => c.clauseId);
    let clauseBodies: Map<string, { title: string; body: string; mergeFields: string[] }> = new Map();

    if (clauseIds.length > 0) {
      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`);
        return tx
          .select({ id: clauseLibrary.id, title: clauseLibrary.title, body: clauseLibrary.body, mergeFields: clauseLibrary.mergeFields })
          .from(clauseLibrary)
          .where(and(inArray(clauseLibrary.id, clauseIds), eq(clauseLibrary.tenantId, ctx.tenantId)));
      });
      clauseBodies = new Map(rows.map((r) => [r.id, { title: r.title, body: r.body, mergeFields: r.mergeFields }]));
    }

    const renderedClauses = rendered.map((tc) => {
      const clauseData = clauseBodies.get(tc.clauseId);
      return {
        id: tc.id,
        clauseId: tc.clauseId,
        rank: tc.rank,
        conditionType: tc.conditionType,
        title: clauseData?.title ?? null,
        body: clauseData?.body ?? null,
        mergeFields: clauseData?.mergeFields ?? [],
      };
    });

    return reply.send({
      data: {
        template: { id: template.id, name: template.name, status: template.status },
        clauses: renderedClauses,
        totalClauses: renderedClauses.length,
      },
    });
  });
}
