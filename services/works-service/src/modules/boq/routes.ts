import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import { listBoqItems, getRecapitulation } from "./repo.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "estimator", "sdo", "section_officer"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function boqRoutes(app: FastifyInstance): Promise<void> {
  // List BoQ items for a work
  app.get("/v1/works/boq/:workId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await listBoqItems(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Get recapitulation for a work
  app.get("/v1/works/boq/:workId/recapitulation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await getRecapitulation(ctx.tenantId, workId);
    if (!data) throw new HttpError(404, "NOT_FOUND", "recapitulation not found");
    return reply.send({ data });
  });

  // Add BoQ item
  app.post("/v1/works/boq", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.addBoqItemSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addBoqItemCommand(ctx, body));
  });

  // Recapitulate
  app.post("/v1/works/boq/recapitulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.recapitulateSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recapitulateCommand(ctx, body));
  });

  // Update BoQ item
  app.patch("/v1/works/boq/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.updateBoqItemSchema.parse({ ...(req.body as object), id: (req.params as { id: string }).id });
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateBoqItemCommand(ctx, body));
  });

  // Delete BoQ item
  app.delete("/v1/works/boq/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.deleteBoqItemSchema.parse({ id: (req.params as { id: string }).id });
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteBoqItemCommand(ctx, body.id));
  });
}
