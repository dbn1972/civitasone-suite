import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as commands from "./amendment-commands.js";
import * as amendRepo from "./amendment-repo.js";
import {
  requestAmendmentBody, approveAmendmentBody, rejectAmendmentBody,
  addMilestoneBody, updateMilestoneBody, closePoBody,
  poIdParam, amendmentIdParam, milestoneIdParam,
} from "./amendment-validators.js";

const WRITE_ROLES  = ["procurement_officer", "procurement_admin", "super_admin"];
const APPROVE_ROLES = ["procurement_admin", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "audit_officer", "finance_officer"];

function ser(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...o };
  for (const k of ["deltaMinor", "prevTotalMinor", "newTotalMinor", "amountMinor"]) {
    if (out[k] !== undefined && out[k] !== null) out[k] = String(out[k]);
  }
  return out;
}

export async function poAmendmentRoutes(app: FastifyInstance): Promise<void> {
  // ── Amendments ──────────────────────────────────────────────────
  app.post("/v1/procurement/pos/:id/amendments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = poIdParam.parse(req.params);
    const body = requestAmendmentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestAmendment(ctx, id, body));
  });

  app.patch("/v1/procurement/pos/:id/amendments/:amendmentId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id, amendmentId } = amendmentIdParam.parse(req.params);
    const body = approveAmendmentBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveAmendment(ctx, id, amendmentId, body));
  });

  app.patch("/v1/procurement/pos/:id/amendments/:amendmentId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id, amendmentId } = amendmentIdParam.parse(req.params);
    const body = rejectAmendmentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectAmendment(ctx, id, amendmentId, body));
  });

  app.get("/v1/procurement/pos/:id/amendments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = poIdParam.parse(req.params);
    const rows = await amendRepo.listAmendmentsByPo(id, ctx.tenantId);
    return reply.send({ data: rows.map((r) => ser(r as unknown as Record<string, unknown>)) });
  });

  // ── Milestones ──────────────────────────────────────────────────
  app.post("/v1/procurement/pos/:id/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = poIdParam.parse(req.params);
    const body = addMilestoneBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addMilestone(ctx, id, body));
  });

  app.patch("/v1/procurement/pos/:id/milestones/:milestoneId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id, milestoneId } = milestoneIdParam.parse(req.params);
    const body = updateMilestoneBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateMilestone(ctx, id, milestoneId, body));
  });

  app.get("/v1/procurement/pos/:id/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = poIdParam.parse(req.params);
    const rows = await amendRepo.listMilestonesByPo(id, ctx.tenantId);
    return reply.send({ data: rows.map((r) => ser(r as unknown as Record<string, unknown>)) });
  });

  // ── Closure ─────────────────────────────────────────────────────
  app.patch("/v1/procurement/pos/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id } = poIdParam.parse(req.params);
    const body = closePoBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.closePo(ctx, id, body));
  });
}
