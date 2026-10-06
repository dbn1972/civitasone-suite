import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { readScoped } from "../../shared/db.js";
import { createBindingBody, breakglassBody, bindingIdParam, revokeBindingBody, listBindingsQuery } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

/**
 * GAP-POLICY-BINDINGS-03: parse the request through zod and map a failure to
 * this service's uniform `{code:"VALIDATION_FAILED"}` 400 envelope, instead of
 * the raw Fastify default 500 the previous `schema.parse(req.body)` calls
 * produced for these two handlers (documented in comp-007-bindings-smoke.test).
 */
function safeParse<O>(schema: z.ZodType<O, z.ZodTypeDef, unknown>, data: unknown): O {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

export async function bindingRoutes(app: FastifyInstance): Promise<void> {
  // GAP-POLICY-BINDINGS-03: the web loader (apps/web .../policy/_data.ts) and
  // BindingCreateForm both call `/api/v1/policy/bindings`, which the gateway's
  // "policy-v1" registry entry forwards to upstream `/v1/policy/bindings`.
  // These routes were previously registered at the bare `/policy/bindings`
  // (no `/v1`), unlike every sibling module here, so the real Bindings page
  // 404'd end-to-end. All three routes are now under `/v1/policy/*` to match.

  // GAP-POLICY-BINDINGS-03: GET list — previously there was NO GET route at
  // all, so the bindings page's loader always hit the 404 error state. The
  // HTTP surface is otherwise write-only (CQRS), but a read-model list is
  // needed for the admin UI; it is tenant-scoped and admin-gated like the rest.
  app.get("/v1/policy/bindings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const q = safeParse(listBindingsQuery, req.query);
    const [rows, total] = await readScoped(ctx.tenantId, async (tx) => [
      await repo.listBindings(tx, ctx.tenantId, q.limit, q.offset),
      await repo.countBindings(tx, ctx.tenantId),
    ] as const);
    return reply.send({ data: rows, limit: q.limit, offset: q.offset, count: rows.length, total });
  });

  app.post("/v1/policy/bindings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = safeParse(createBindingBody, req.body);
    // GAP-POLICY-BINDINGS-01: forbid self-escalation. An admin must not grant a
    // role to their own account (would let a compromised/over-eager admin
    // escalate themselves with no second party). Grants to others are audited
    // by the create consumer (emits policy.binding.created + audit.event.record
    // in the same transaction — see consumer.ts).
    if (body.userId === ctx.actorId) {
      throw new HttpError(403, "SELF_BINDING_FORBIDDEN", "You cannot bind a role to your own account");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBinding(ctx, body));
  });

  app.delete("/v1/policy/bindings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = safeParse(bindingIdParam, req.params);
    const { reason } = safeParse(revokeBindingBody, req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeBinding(ctx, id, reason));
  });

  app.post("/v1/policy/breakglass", async (req, reply) => {
    const ctx = resolveContext(req);
    // SEC: this handler had no requireRole call at all, unlike both sibling
    // mutating routes in this file (createBinding/revokeBinding, which gate on
    // the same ADMIN roles below). requestBreakglass() currently only inserts
    // a 'pending' row (nothing consumes/approves it yet — see commands.ts /
    // consumer.ts), so this was not exploitable for actual privilege
    // escalation today, but any authenticated user of any role, in any
    // tenant, could otherwise spam breakglass requests for an arbitrary
    // `scope` string. Gate it the same as its siblings for consistency and
    // defense-in-depth ahead of the approval flow being built out.
    requireRole(ctx, ADMIN);
    const body = safeParse(breakglassBody, req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestBreakglass(ctx, body));
  });
}
