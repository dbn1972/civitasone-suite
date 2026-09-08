/**
 * SAML 2.0 Identity Provider module.
 *
 * Provides SP-initiated SSO (redirect binding) and IdP metadata endpoint.
 * Integrates with Keycloak as the underlying IdP, exposing SAML endpoints
 * for government SSO providers (MeriPehchaan, eSign, DigiLocker).
 *
 * Env vars (fallback only — see DOM-005 note on PUT/GET below):
 *   SAML_ENTITY_ID       — SP entity ID (default: civitasone)
 *   SAML_ACS_URL         — Assertion Consumer Service URL
 *   SAML_IDP_METADATA    — IdP metadata XML URL or inline XML
 *   SAML_CERT_PATH       — path to SP signing certificate
 *   SAML_KEY_PATH        — path to SP private key
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./repo.js";

const ADMIN_ROLES = ["identity_admin", "super_admin"];

const samlConfigBody = z.object({
  entityId: z.string().min(1).max(512),
  acsUrl: z.string().url().max(2048),
  idpMetadataUrl: z.string().url().max(2048).optional(),
  idpMetadataXml: z.string().max(65536).optional(),
  signRequests: z.boolean().default(true),
  nameIdFormat: z.enum(["email", "persistent", "transient"]).default("email"),
});

export async function samlRoutes(app: FastifyInstance): Promise<void> {
  /** GET /v1/identity/saml/metadata — SP metadata XML (public) */
  app.get("/v1/identity/saml/metadata", async (_req, reply) => {
    const entityId = process.env.SAML_ENTITY_ID ?? "civitasone";
    const acsUrl = process.env.SAML_ACS_URL ?? "https://app.civitasone.in/api/auth/saml/acs";
    const xml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <SPSSODescriptor AuthnRequestsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0"/>
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
  </SPSSODescriptor>
</EntityDescriptor>`;
    return reply.header("Content-Type", "application/xml").send(xml);
  });

  /** POST /v1/identity/saml/acs — Assertion Consumer Service (IdP posts here) */
  app.post("/v1/identity/saml/acs", async (req, reply) => {
    // TODO: Parse SAML Response, validate signature, extract attributes,
    // create/link session. For now, return 501 pending full implementation.
    return reply.code(501).send({ code: "NOT_IMPLEMENTED", message: "SAML ACS handler pending full implementation" });
  });

  /**
   * PUT /v1/identity/saml/config — configure SAML SP settings (admin)
   *
   * DOM-005 fix: this used to return 202 "accepted" without writing the
   * submitted config anywhere — every "save" was silently discarded. Now
   * persists a real per-tenant row in saml.tenant_config (RLS-scoped,
   * migration 0021) and returns 200 with what was actually saved.
   */
  app.put("/v1/identity/saml/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = samlConfigBody.parse(req.body);
    const saved = await repo.upsert(ctx.tenantId, ctx.actorId, body);
    return reply.code(200).send({
      entityId: saved.entityId,
      acsUrl: saved.acsUrl,
      idpMetadataUrl: saved.idpMetadataUrl ?? undefined,
      idpMetadataXml: saved.idpMetadataXml ?? undefined,
      signRequests: saved.signRequests,
      nameIdFormat: saved.nameIdFormat,
      updatedAt: saved.updatedAt.toISOString(),
      version: saved.version,
    });
  });

  /**
   * GET /v1/identity/saml/config — get current SAML config (admin)
   *
   * DOM-005 fix: this used to echo process.env vars back as if they were the
   * tenant's stored config (they aren't tenant-scoped and are never written
   * by PUT). Now reads the real per-tenant row; honestly reports
   * `configured: false` — not env-var fallbacks — when none has been saved.
   */
  app.get("/v1/identity/saml/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const row = await repo.findByTenant(ctx.tenantId);
    if (!row) {
      return reply.code(200).send({ configured: false });
    }
    return reply.code(200).send({
      configured: true,
      entityId: row.entityId,
      acsUrl: row.acsUrl,
      idpMetadataUrl: row.idpMetadataUrl ?? undefined,
      idpMetadataXml: row.idpMetadataXml ?? undefined,
      signRequests: row.signRequests,
      nameIdFormat: row.nameIdFormat,
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    });
  });
}
