import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin", "install_admin", "tenant_admin"];

const packIdParam = z.object({ id: z.string().uuid() });
const domainPackKeyParam = z.object({
  domainPackKey: z.string().min(1).max(64),
});
const activateDomainPackBody = z.object({
  packKeys: z.array(z.string().min(1).max(64)).max(50).optional(),
});

const domainPackActivateAcceptedSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("accepted"),
  correlationId: z.string(),
  domainPackKey: z.string(),
  draftIds: z.array(z.string().uuid()),
  packKeys: z.array(z.string()),
});

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

  app.post("/v1/citizen/packs/services/:id/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = packIdParam.parse(req.params);
    const accepted = await commands.importServicePack(ctx, id);
    return sendAccepted(reply, z.object({
      id: z.string(),
      status: z.literal("accepted"),
      correlationId: z.string(),
    }), { ...accepted, status: "accepted" as const });
  });

  /** FN-17 / FN-20 — activate Domain Pack → ≥3 editable drafts (TL/PGR/Water for municipal-in-v1). */
  app.post("/v1/citizen/packs/domain/:domainPackKey/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { domainPackKey } = domainPackKeyParam.parse(req.params);
    const body = activateDomainPackBody.parse(req.body ?? {});
    const accepted = await commands.activateDomainPack(ctx, domainPackKey, body.packKeys);
    return sendAccepted(reply, domainPackActivateAcceptedSchema, {
      ...accepted,
      status: "accepted" as const,
    });
  });
}
