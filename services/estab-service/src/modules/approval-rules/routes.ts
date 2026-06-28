import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createApprovalRuleBody, updateApprovalRuleBody, listRulesQuery, resolveQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { resolveApproval } from "./resolver.js";

const ADMIN_ROLES = ["estab_admin", "super_admin", "tenant_admin"];
const READER_ROLES = [...ADMIN_ROLES, "estab_officer", "audit_officer"];

export async function approvalRulesRoutes(app: FastifyInstance): Promise<void> {
  /** List approval rules (admin matrix view). */
  app.get("/v1/estab/approval-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listRulesQuery.parse(req.query);
    const data = await queries.listApprovalRules(ctx.tenantId, q);
    return reply.send({ data });
  });

  /** Get one rule. */
  app.get("/v1/estab/approval-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
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
    const result = await commands.createApprovalRule(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, result);
  });

  /** Update / activate / deactivate an approval rule. */
  app.patch("/v1/estab/approval-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = req.params as { id: string };
    const body = updateApprovalRuleBody.parse(req.body);
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
