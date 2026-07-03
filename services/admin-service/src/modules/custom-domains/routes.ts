/**
 * Custom Domains module HTTP routes (Fastify plugin).
 * Register, verify, and manage custom domains for tenants.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import * as commands from "./commands.js";
import { registerDomainBody, domainIdParam } from "./validators.js";
import { customDomains } from "./schema.js";
import { eq, and } from "drizzle-orm";

const ADMIN_ROLES = ["platform_admin", "super_admin"];
const RESOURCE = "custom_domain";

function safeParse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

export async function customDomainRoutes(app: FastifyInstance): Promise<void> {
  // LIST domains for tenant
  app.get("/v1/admin/custom-domains", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const rows = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, "list"),
      async () => db.select().from(customDomains).where(eq(customDomains.tenantId, ctx.tenantId)),
    );
    return reply.send({ data: rows });
  });

  // REGISTER domain
  app.post("/v1/admin/custom-domains", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = safeParse(registerDomainBody, req.body);
    const result = await commands.domainRegister(ctx, body);
    return reply.code(202).send(result);
  });

  // VERIFY domain DNS
  app.post("/v1/admin/custom-domains/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(domainIdParam, req.params);
    const result = await commands.domainVerify(ctx, id);
    return reply.code(202).send(result);
  });

  // DELETE domain
  app.delete("/v1/admin/custom-domains/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(domainIdParam, req.params);
    const result = await commands.domainDelete(ctx, id);
    return reply.code(202).send(result);
  });

  // DNS INSTRUCTIONS
  app.get("/v1/admin/custom-domains/:id/dns-instructions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(domainIdParam, req.params);
    const row = await db.select().from(customDomains)
      .where(and(eq(customDomains.id, id), eq(customDomains.tenantId, ctx.tenantId)))
      .then((rows) => rows[0]);
    if (!row) throw new HttpError(404, "NOT_FOUND", "domain not found");

    const instructions = row.verificationMethod === "dns_txt"
      ? {
          type: "TXT",
          host: "_civitasone-verification",
          value: row.verificationToken,
          instructions: `Add a TXT record to your DNS with host "_civitasone-verification.${row.domain}" and value "${row.verificationToken}"`,
        }
      : {
          type: "CNAME",
          host: `_civitasone-verify.${row.domain}`,
          value: `verify.civitasone.app`,
          instructions: `Add a CNAME record pointing "_civitasone-verify.${row.domain}" to "verify.civitasone.app"`,
        };

    return reply.send({ data: { domain: row.domain, status: row.status, ...instructions } });
  });
}
