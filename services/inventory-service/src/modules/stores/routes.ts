import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler } from "../../shared/context.js";
import { createStoreBody, storeQueryParams } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

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

  registerErrorHandler(app);
}
