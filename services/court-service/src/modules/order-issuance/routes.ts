import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  orderIdParam,
  submitForApprovalBody,
  approveAndIssueBody,
  sendBackBody,
  recallBody,
} from "./validators.js";
import * as commands from "./commands.js";

// Makers who may DRAFT + submit an order for approval (§23).
const ISSUANCE_SUBMIT_ROLES = ["registrar", "court_admin", "judge", "super_admin"];
// Checkers/bench who may APPROVE+ISSUE, send back, or recall (§23 + §35.5). The
// approver is additionally enforced (in the consumer) to differ from the maker.
const ISSUANCE_CHECK_ROLES = ["judge", "court_admin", "super_admin"];

export async function orderIssuanceRoutes(app: FastifyInstance): Promise<void> {
  // Submit a drafted order for approval (draft → pending_approval).
  app.patch("/v1/court/orders/:id/submit-for-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ISSUANCE_SUBMIT_ROLES);
    const { id } = orderIdParam.parse(req.params);
    const body = submitForApprovalBody.parse(req.body);
    const result = await commands.submitForApproval(ctx, id, body);
    return reply.code(202).send(result);
  });

  // Approve + issue (pronounce) an order (pending_approval → issued).
  // Maker-checker: the consumer rejects a self-approval (approver ≠ maker); §35.5
  // issuance is a human, DSC-signed act — never an AI/service actor.
  app.patch("/v1/court/orders/:id/approve-issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ISSUANCE_CHECK_ROLES);
    const { id } = orderIdParam.parse(req.params);
    const body = approveAndIssueBody.parse(req.body);
    const result = await commands.approveAndIssue(ctx, id, body);
    return reply.code(202).send(result);
  });

  // Send a pending order back to its maker for revision (pending_approval → draft).
  app.patch("/v1/court/orders/:id/send-back", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ISSUANCE_CHECK_ROLES);
    const { id } = orderIdParam.parse(req.params);
    const body = sendBackBody.parse(req.body);
    const result = await commands.sendBack(ctx, id, body);
    return reply.code(202).send(result);
  });

  // Recall an already-issued order (issued → recalled).
  app.patch("/v1/court/orders/:id/recall", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ISSUANCE_CHECK_ROLES);
    const { id } = orderIdParam.parse(req.params);
    const body = recallBody.parse(req.body);
    const result = await commands.recall(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "order-issuance route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
