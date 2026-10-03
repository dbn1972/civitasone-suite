/**
 * GAP-ADMIN-OPERATORS-05: platform-operator directory and its maker-checker
 * management actions. Reached through the gateway as /api/v1/admin/operators.
 * Reads need a platform role; deciding a request needs super_admin (and the
 * consumer re-checks the decider is an active super_admin and not the maker).
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { PLATFORM_ROLE_KEYS, REQUEST_KINDS, APPROVER_ROLE_KEY } from "./domain.js";

const PLATFORM = [...PLATFORM_ROLE_KEYS];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const requestsQuery = listQuery.extend({
  status: z.enum(["pending", "approved", "rejected", "cancelled", "refused"]).optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const requestBody = z.object({
  kind: z.enum(REQUEST_KINDS),
  reason: z.string().trim().min(3).max(500),
  toRole: z.enum(PLATFORM_ROLE_KEYS).optional(),
}).superRefine((b, ctx) => {
  if (b.kind === "role_change" && !b.toRole) ctx.addIssue({ code: "custom", path: ["toRole"], message: "required for a role change" });
  if (b.kind !== "role_change" && b.toRole) ctx.addIssue({ code: "custom", path: ["toRole"], message: "only valid for a role change" });
});
const decideBody = z.object({ note: z.string().trim().max(500).optional() });
const rejectBody = z.object({ note: z.string().trim().min(3).max(500) });

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new HttpError(400, "VALIDATION_FAILED", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export async function operatorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/identity/operators", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM);
    const q = parse(listQuery, req.query);
    const { rows, total } = await repo.listOperators(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/identity/operators/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM);
    const q = parse(requestsQuery, req.query);
    const { rows, total } = await repo.listRequests(ctx.tenantId, q.status ?? null, q.limit, q.offset);
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.post("/identity/operators/:id/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM);
    const { id } = parse(idParam, req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestChange(ctx, id, parse(requestBody, req.body)));
  });

  app.post("/identity/operators/requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [APPROVER_ROLE_KEY]);
    const { id } = parse(idParam, req.params);
    const b = parse(decideBody, req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.decide(ctx, id, "approve", b.note));
  });

  app.post("/identity/operators/requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [APPROVER_ROLE_KEY]);
    const { id } = parse(idParam, req.params);
    const b = parse(rejectBody, req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.decide(ctx, id, "reject", b.note));
  });

  app.post("/identity/operators/requests/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM);
    const { id } = parse(idParam, req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancel(ctx, id));
  });
}
