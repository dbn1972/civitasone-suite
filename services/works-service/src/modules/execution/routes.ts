import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import {
  listScopes, listIssues, listExecutionProgress, listAllIssues, listClosures,
  getWorkScope, listScopeProgress,
} from "./repo.js";
import { getAward } from "../tender/repo.js";
import { canRecordPhysicalCompletion, canApplyProgressDelta, validateProgressNotExceedTarget } from "./domain.js";
import { paginationSchema } from "../masters/validators.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  // Tenant-wide execution progress register (paginated) — the FE execution list page.
  app.get("/v1/works/execution/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const data = await listExecutionProgress(ctx.tenantId, query.page, query.pageSize);
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total: data.length } });
  });

  // Tenant-wide issues register (paginated) — the FE execution issues list.
  app.get("/v1/works/execution/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const data = await listAllIssues(ctx.tenantId, query.page, query.pageSize);
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total: data.length } });
  });

  // Tenant-wide closure register (paginated) — the FE closure list page.
  app.get("/v1/works/closure", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const data = await listClosures(ctx.tenantId, query.page, query.pageSize);
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total: data.length } });
  });

  // List scopes
  app.get("/v1/works/execution/:workId/scopes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await listScopes(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // List issues
  app.get("/v1/works/execution/:workId/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await listIssues(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Add scope
  app.post("/v1/works/execution/scopes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.addScopeSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addScopeCommand(ctx, body));
  });

  // Record progress
  app.post("/v1/works/execution/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.recordProgressSchema.parse(req.body);

    // Bug #5: a negative delta (would take cumulative achievement backward)
    // is only accepted when explicitly flagged as a correction.
    if (!canApplyProgressDelta(body.currentAchievement, body.correctionReason)) {
      throw new HttpError(
        422,
        "NEGATIVE_PROGRESS_REQUIRES_REASON",
        "A negative progress delta requires a non-empty correctionReason",
      );
    }

    // Bug #3: the progress-vs-target cap was previously enforced only inside
    // the async consumer, so the route always returned 202 even when the
    // write would be silently dropped. Enforce it synchronously here too —
    // the consumer keeps its own check as defense in depth.
    const scope = await getWorkScope(ctx.tenantId, body.workScopeId);
    if (!scope) throw new HttpError(404, "NOT_FOUND", "work scope not found");
    if (scope.targetValue != null) {
      const priorRows = await listScopeProgress(ctx.tenantId, body.workScopeId);
      const prior = priorRows.reduce((sum, r) => sum + Number(r.currentAchievement ?? 0), 0);
      const cumulative = prior + body.currentAchievement;
      const target = Number(scope.targetValue);
      if (!validateProgressNotExceedTarget(cumulative, target)) {
        throw new HttpError(
          422,
          "PROGRESS_EXCEEDS_TARGET",
          `Cumulative progress (${cumulative}) would exceed scope target (${target})`,
        );
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.recordProgressCommand(ctx, body));
  });

  // Upload photo
  app.post("/v1/works/execution/photos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.uploadPhotoSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.uploadPhotoCommand(ctx, body));
  });

  // Create issue
  app.post("/v1/works/execution/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createIssueSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createIssueCommand(ctx, body));
  });

  // Close issue
  app.post("/v1/works/execution/issues/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.closeIssueSchema.parse({ id: (req.params as { id: string }).id });
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeIssueCommand(ctx, body.id));
  });

  // Close work
  app.post("/v1/works/execution/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "do", "works_admin", "super_admin"]);
    const body = v.closeWorkSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeWorkCommand(ctx, body));
  });

  // Record physical completion certificate (SVC-070).
  // Precondition (BR-035): a finalized agreement (award) must exist.
  app.post("/v1/works/execution/physical-complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "do", "sdo", "works_admin", "super_admin"]);
    const body = v.physicalCompleteSchema.parse(req.body);
    const award = await getAward(ctx.tenantId, body.workId);
    const hasAgreement = !!award && (award.status === "dao_finalized" || award.status === "do_finalized");
    if (!canRecordPhysicalCompletion(hasAgreement)) {
      throw new HttpError(422, "NO_AGREEMENT", "Cannot record physical completion without a finalized agreement");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.physicalCompleteCommand(ctx, body));
  });
}
