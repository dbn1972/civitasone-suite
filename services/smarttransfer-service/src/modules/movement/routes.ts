import type { FastifyInstance } from "fastify";
import { getCommandResult } from "@civitasone/outbox";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { requireSmartTransferEntitlement } from "../../shared/entitlement.js";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { createCycleBody, listQuery, commandIdParam, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

/**
 * Every SmartTransfer route is STAFF-ONLY. `citizen` is deliberately NOT in
 * this list (house rule 9). super_admin is included per the fleet convention.
 * Employee self-service (spec §9) is a later milestone with its own guarded
 * surface; it is not part of this skeleton.
 */
const ST_ROLES = ["smarttransfer_user", "smarttransfer_admin", "dept_head", "officer", "super_admin"];

export async function cycleRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/smarttransfer/cycles — the one example write path.
  //   requireRole → entitlement re-check (fails CLOSED) → zod → 202.
  app.post("/v1/smarttransfer/cycles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ST_ROLES);
    await requireSmartTransferEntitlement(ctx);
    const body = createCycleBody.parse(req.body);
    return reply.code(202).send(await commands.createCycle(ctx, body));
  });

  // GET /v1/smarttransfer/cycles — list scoped to the caller's jurisdiction.
  app.get("/v1/smarttransfer/cycles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ST_ROLES);
    await requireSmartTransferEntitlement(ctx);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listCycles(ctx.tenantId, {
      status: q.status,
      page: q.page,
      pageSize: q.pageSize,
      jurisdictionUnitIds: ctx.jurisdictionUnitIds,
    });
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  // GET /v1/smarttransfer/cycles/:id — read-through cache.
  app.get("/v1/smarttransfer/cycles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ST_ROLES);
    await requireSmartTransferEntitlement(ctx);
    const { id } = idParam.parse(req.params);
    const key = cache.makeKey(ctx.tenantId, "cycle", id);
    const row = await cache.getOrLoad(key, () => repo.findCycleById(id, ctx.tenantId));
    // Jurisdiction scope is applied AFTER the (tenant-keyed) cache read so a
    // cached row can never bypass it; out of scope is indistinguishable from
    // absent (404), same predicate as the list.
    if (!row || !repo.cycleInScope(row, ctx.jurisdictionUnitIds)) {
      throw new HttpError(404, "CYCLE_NOT_FOUND", "cycle not found");
    }
    return reply.send({ data: row });
  });
}

/**
 * Command status route (D-20): GET /v1/smarttransfer/commands/:commandId.
 * Returns the D-20 status view — status + code + params only, NEVER the
 * free-text reason. tenantId is the CALLER's own (server context), the only
 * thing (beside FORCE RLS on the table and its explicit filter) standing between a caller
 * and another tenant's result. 404 while still in flight is distinct from a
 * rejected outcome (I5): processing → 404, terminal → 200.
 */
export async function commandStatusRoutes(app: FastifyInstance): Promise<void> {
  const STATUS_ROLES = ST_ROLES;
  app.get("/v1/smarttransfer/commands/:commandId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STATUS_ROLES);
    await requireSmartTransferEntitlement(ctx);
    const { commandId } = commandIdParam.parse(req.params);
    const view = await scopedRead((tx) => getCommandResult(tx, ctx.tenantId, commandId));
    if (!view) throw new HttpError(404, "COMMAND_PENDING", "command is still processing or unknown");
    return reply.send({ data: view });
  });
}
