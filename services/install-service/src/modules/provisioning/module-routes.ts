import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MODULE_MANIFEST } from "@civitasone/schemas/module-manifest";
import { resolveModules } from "@civitasone/schemas/module-resolver";
import { resolveContext, requireRole } from "../../shared/context.js";

const READER_ROLES = ["install_admin", "super_admin", "platform_admin", "tenant_admin"];

const resolveBody = z.object({
  selected: z.array(z.string().min(1).max(64)),
});

/**
 * Routes for module dependency resolution — used by the install/setup UI
 * to show the full manifest and preview dependency resolution.
 */
export async function moduleRoutes(app: FastifyInstance): Promise<void> {
  /** Returns the full module manifest for the UI module-selection screen. */
  app.get("/v1/install/modules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({ data: MODULE_MANIFEST });
  });

  /** Resolves dependencies for a proposed module selection. */
  app.post("/v1/install/modules/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { selected } = resolveBody.parse(req.body);
    const result = resolveModules(selected);
    return reply.send({ data: result });
  });
}
