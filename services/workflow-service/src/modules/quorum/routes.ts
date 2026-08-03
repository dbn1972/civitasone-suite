import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { tallyQuorum, consolidateParallel, type QuorumRule, type VoteChoice, type ParallelMode, type BranchOutcome } from "./domain.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

export async function quorumRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/committee-decisions", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      instanceId: z.string().uuid().nullable().optional(), taskId: z.string().uuid().nullable().optional(),
      nodeKey: z.string().max(64).nullable().optional(), subject: z.string().min(1).max(256),
      rule: z.enum(["majority", "unanimous", "threshold"]).default("majority"),
      threshold: z.number().int().positive().nullable().optional(), totalMembers: z.number().int().positive(),
    }).parse(req.body);
    if (body.rule === "threshold" && !body.threshold) throw new HttpError(400, "THRESHOLD_REQUIRED", "threshold rule requires a positive threshold");
    if (body.threshold && body.threshold > body.totalMembers) throw new HttpError(400, "THRESHOLD_TOO_HIGH", "threshold cannot exceed totalMembers");
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCommitteeDecision(ctx, {
      instanceId: body.instanceId ?? null, taskId: body.taskId ?? null, nodeKey: body.nodeKey ?? null,
      subject: body.subject, rule: body.rule, threshold: body.threshold ?? null, totalMembers: body.totalMembers,
    }));
  });

  app.post("/v1/workflow/committee-decisions/:id/votes", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ vote: z.enum(["approve", "reject", "abstain"]), reason: z.string().max(512).nullable().optional() }).parse(req.body);
    const existing = await repo.findDecision(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "committee decision not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.castCommitteeVote(ctx, id, {
      vote: body.vote, reason: body.reason ?? null,
    }));
  });

  app.get("/v1/workflow/committee-decisions/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const decision = await repo.findDecision(id, ctx.tenantId);
    if (!decision) throw new HttpError(404, "NOT_FOUND", "committee decision not found");
    const votes = await repo.listVotes(id, ctx.tenantId);
    const tally = tallyQuorum({ rule: decision.rule as QuorumRule, totalMembers: decision.totalMembers, threshold: decision.threshold, votes: votes.map((v) => v.vote as VoteChoice) });
    return reply.send({ data: { decision, votes, tally } });
  });

  app.post("/v1/workflow/parallel/consolidate", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({ mode: z.enum(["all", "any"]), branches: z.array(z.enum(["approve", "reject", "pending"])).min(1) }).parse(req.body);
    return reply.send({ data: consolidateParallel(body.mode as ParallelMode, body.branches as BranchOutcome[]) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
