import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import { createStoreBody, storeQueryParams, patchStoreBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const WRITE_ROLES  = ["inventory_manager", "inventory_admin", "super_admin"];
const READER_ROLES = ["inventory_user", "inventory_manager", "inventory_admin", "store_keeper", "audit_officer", "super_admin"];

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/inventory/stores", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createStoreBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createStore(ctx, body));
  });

  app.get("/v1/inventory/stores", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = storeQueryParams.parse(req.query);
    return reply.send({ data: await queries.listStores(ctx.tenantId, q.limit, q.offset) });
  });

  app.patch("/v1/inventory/stores/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = patchStoreBody.parse(req.body);
    const existing = await repo.findStore(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "store not found");
    const patch: { name?: string; code?: string; location?: string | null } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.code !== undefined) patch.code = body.code;
    if (body.location !== undefined) patch.location = body.location;
    const updated = await repo.updateStore(id, ctx.tenantId, patch, ctx.actorId);
    if (!updated) throw new HttpError(404, "NOT_FOUND", "store not found");
    return reply.send(updated);
  });


  registerErrorHandler(app);
}
