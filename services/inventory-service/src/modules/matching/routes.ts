/**
 * matching HTTP routes — three-way match verification and discrepancy resolution.
 * Reads are tenant-scoped; writes are role-gated and run through the queue.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import {
  createMatchBody, resolveMatchBody, matchQueryParams, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const WRITE_ROLES    = ["procurement_officer", "procurement_admin", "inventory_manager", "inventory_admin", "finance_officer", "super_admin"];
const RESOLVE_ROLES  = ["procurement_admin", "inventory_admin", "finance_officer", "super_admin"];
const READER_ROLES   = [...WRITE_ROLES, "audit_officer"];

export async function matchingRoutes(app: FastifyInstance): Promise<void> {
  // ── Create three-way match ────────────────────────────────────────────────
  app.post("/v1/inventory/matches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createMatchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createMatch(ctx, body));
  });

  // ── Get match by ID ───────────────────────────────────────────────────────
  app.get("/v1/inventory/matches/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const record = await queries.getMatch(ctx.tenantId, id);
    if (!record) throw new HttpError(404, "NOT_FOUND", "match record not found");
    return reply.send({ data: record });
  });

  // ── List matches ──────────────────────────────────────────────────────────
  app.get("/v1/inventory/matches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = matchQueryParams.parse(req.query);
    return reply.send(await queries.listMatches(ctx.tenantId, q));
  });

  // ── Resolve discrepancy ───────────────────────────────────────────────────
  app.post("/v1/inventory/matches/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RESOLVE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveMatchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.resolveMatch(ctx, id, body.version, body.resolutionNote));
  });

  registerErrorHandler(app);
}
