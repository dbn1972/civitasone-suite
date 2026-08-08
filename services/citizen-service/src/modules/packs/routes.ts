import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

const packIdParam = z.object({ id: z.string().uuid() });
const exportBody = z.object({
  definitionId: z.string().uuid(),
});
const importBody = z.object({
  acknowledgeStatutory: z.boolean().optional(),
}).default({});

export async function packsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/citizen/packs/domain", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await repo.listDomainPacks(ctx.tenantId) });
  });

  app.get("/v1/citizen/packs/services", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const domainPackKey = typeof (req.query as { domainPackKey?: string }).domainPackKey === "string"
      ? (req.query as { domainPackKey: string }).domainPackKey
      : undefined;
    return reply.send({ data: await repo.listServicePacks(ctx.tenantId, domainPackKey) });
  });

  app.get("/v1/citizen/packs/services/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = packIdParam.parse(req.params);
    const pack = await repo.findServicePackById(id, ctx.tenantId);
    if (!pack) return reply.code(404).send({ code: "NOT_FOUND", message: "service pack not found" });
    return reply.send(pack);
  });

  /** FN-09 — export published catalogue definition → versioned service pack. */
  app.post("/v1/citizen/packs/services/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = exportBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.exportServicePack(ctx, body.definitionId));
  });

  app.post("/v1/citizen/packs/services/:id/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = packIdParam.parse(req.params);
    const body = importBody.parse(req.body ?? {});
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.importServicePack(ctx, id, { acknowledgeStatutory: body.acknowledgeStatutory }),
    );
  });
}
