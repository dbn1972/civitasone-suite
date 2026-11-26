import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createApprovalRuleBody, updateApprovalRuleBody, listRulesQuery, resolveQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { findRuleById } from "./repo.js";
import { resolveApproval } from "./resolver.js";
import { assertApproverRolesKnownForTenant, loadApproverRoleCatalogue } from "./roleCatalogue.js";
import { findOverlappingRule, describeBand } from "./bands.js";
import { listActiveRulesForSource } from "./repo.js";

const ADMIN_ROLES = ["estab_admin", "super_admin", "tenant_admin"];
const READER_ROLES = [...ADMIN_ROLES, "estab_officer", "audit_officer"];

// UAT W8-A: a malformed :id reached the uuid column and 500ed (22P02); it is a 400 now.
const idParam = z.object({ id: z.string().uuid() });

export async function approvalRulesRoutes(app: FastifyInstance): Promise<void> {
  /** List approval rules (admin matrix view), plus the approver-role catalogue for the form. */
  app.get("/v1/estab/approval-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listRulesQuery.parse(req.query);
    const data = await queries.listApprovalRules(ctx.tenantId, q);
    // GAP-ESTAB-APPROVAL-MATRIX-03: the approver roles a rule may name travel with the list, so
    // the matrix form knows its choices in the same read (see roleCatalogue.ts for how the
    // list is configured; configured:false means no list was declared).
    return reply.send({ data, approverRoles: await loadApproverRoleCatalogue(ctx.tenantId) });
  });

  /** Get one rule. */
  app.get("/v1/estab/approval-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rule = await queries.getApprovalRule(ctx.tenantId, id);
    if (!rule) throw new HttpError(404, "NOT_FOUND", "approval rule not found");
    return reply.send({ data: rule });
  });

  /**
   * Resolve which approval chain applies to a (sourceType, amount).
   * Modules call this to preview routing before raising a file.
   */
  app.get("/v1/estab/approval-rules/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = resolveQuery.parse(req.query);
    const resolved = await resolveApproval(ctx.tenantId, q.sourceType, q.amountMinor);
    if (!resolved) return reply.send({ data: null });
    return reply.send({ data: resolved });
  });

  /** Create a new approval rule. */
  app.post("/v1/estab/approval-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createApprovalRuleBody.parse(req.body);
    await assertApproverRolesKnownForTenant(ctx.tenantId, body.steps);
    // B22: a new active rule may not overlap an existing active band of the same source type.
    const clash = findOverlappingRule(await listActiveRulesForSource(ctx.tenantId, body.sourceType), body);
    if (clash) {
      throw new HttpError(409, "OVERLAPPING_BAND", `amount band ${describeBand(body)} overlaps active rule "${clash.label}" ${describeBand(clash)}`);
    }
    const result = await commands.createApprovalRule(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, result);
  });

  /** Update / activate / deactivate an approval rule. */
  app.patch("/v1/estab/approval-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateApprovalRuleBody.parse(req.body);
    await assertApproverRolesKnownForTenant(ctx.tenantId, body.steps);
    // UAT W8-A: tenant-scoped existence read; an unknown rule answers 404, not 202.
    const existing = await findRuleById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "approval rule not found");
    // B22: only a patch that moves the band or (re)activates the rule can create an overlap; label /
    // chain / deactivation edits on a legacy overlapping rule stay allowed.
    const bandChanged = body.minAmountMinor !== undefined || body.maxAmountMinor !== undefined;
    const willBeActive = body.active ?? existing.active;
    if (willBeActive && (bandChanged || (body.active === true && !existing.active))) {
      const next = {
        minAmountMinor: body.minAmountMinor ?? existing.minAmountMinor,
        maxAmountMinor: body.maxAmountMinor !== undefined ? body.maxAmountMinor : existing.maxAmountMinor,
      };
      if (next.maxAmountMinor !== null && next.maxAmountMinor <= next.minAmountMinor) {
        throw new HttpError(400, "VALIDATION_FAILED", "maxAmountMinor must be greater than minAmountMinor");
      }
      const clash = findOverlappingRule(await listActiveRulesForSource(ctx.tenantId, existing.sourceType), next, id);
      if (clash) {
        throw new HttpError(409, "OVERLAPPING_BAND", `amount band ${describeBand(next)} overlaps active rule "${clash.label}" ${describeBand(clash)}`);
      }
    }
    const result = await commands.updateApprovalRule(ctx, id, body);
    return sendAccepted(reply, acceptedResponseSchema, result);
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
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
