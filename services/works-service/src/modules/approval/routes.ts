import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { resolveApprovalType, canFinalize, canEnterTS } from "./domain.js";
import { countAaForWork, countTsForWork, getAa, getTs } from "./repo.js";
import { getProposal } from "../proposal/repo.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

const aaAcceptedSchema = acceptedResponseSchema.extend({ approvalType: z.string() });
const tsAcceptedSchema = acceptedResponseSchema.extend({ sanctionType: z.string() });

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  // Create AA
  app.post("/v1/works/approvals/aa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createAaSchema.parse(req.body);
    const count = await countAaForWork(ctx.tenantId, body.workId);
    const approvalType = resolveApprovalType(count);
    return sendValidated(reply, aaAcceptedSchema, await commands.createAaCommand(ctx, body, approvalType), 202);
  });

  // Finalize AA
  app.post("/v1/works/approvals/aa/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = req.params as { id: string };
    const aa = await getAa(ctx.tenantId, id);
    if (!aa) throw new HttpError(404, "NOT_FOUND", "AA not found");

    const check = canFinalize({ id: aa.id, status: aa.status });
    if (!check.allowed) throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeAaCommand(ctx, id));
  });

  // Create TS — requires DAO finalization (BR-011)
  app.post("/v1/works/approvals/ts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createTsSchema.parse(req.body);

    // BR-011: Check DAO gate
    const proposal = await getProposal(ctx.tenantId, body.workId);
    if (!proposal) throw new HttpError(404, "NOT_FOUND", "work proposal not found");

    const gate = canEnterTS(proposal.status);
    if (!gate.allowed) throw new HttpError(422, "DAO_GATE_BLOCKED", gate.blockingReason!);

    const count = await countTsForWork(ctx.tenantId, body.workId);
    const sanctionType = resolveApprovalType(count);
    return sendValidated(reply, tsAcceptedSchema, await commands.createTsCommand(ctx, body, sanctionType), 202);
  });

  // Finalize TS
  app.post("/v1/works/approvals/ts/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = req.params as { id: string };
    const ts = await getTs(ctx.tenantId, id);
    if (!ts) throw new HttpError(404, "NOT_FOUND", "TS not found");

    const check = canFinalize({ id: ts.id, status: ts.status });
    if (!check.allowed) throw new HttpError(422, "FINALIZATION_BLOCKED", check.reason!);

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeTsCommand(ctx, id));
  });
}
