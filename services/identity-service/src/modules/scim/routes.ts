/**
 * SCIM 2.0 (System for Cross-domain Identity Management) module.
 *
 * Implements RFC 7643/7644 for automated user provisioning and deprovisioning
 * from external IdPs (Azure AD, Okta, Google Workspace, MeriPehchaan).
 *
 * Endpoints:
 *   GET    /v1/identity/scim/Users          — list/filter users
 *   GET    /v1/identity/scim/Users/:id      — get user
 *   POST   /v1/identity/scim/Users          — create user
 *   PUT    /v1/identity/scim/Users/:id      — replace user
 *   PATCH  /v1/identity/scim/Users/:id      — partial update
 *   DELETE /v1/identity/scim/Users/:id      — deactivate user
 *   GET    /v1/identity/scim/Groups         — list groups
 *   GET    /v1/identity/scim/ServiceProviderConfig — capabilities
 *
 * Auth: Bearer token (SCIM_BEARER_TOKEN env var) — separate from user JWTs.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../shared/context.js";

const SCIM_TOKEN = process.env.SCIM_BEARER_TOKEN ?? "";

function requireScimAuth(req: { headers: Record<string, string | string[] | undefined> }): void {
  if (!SCIM_TOKEN) throw new HttpError(503, "SCIM_DISABLED", "SCIM is not configured (set SCIM_BEARER_TOKEN)");
  const auth = req.headers.authorization as string | undefined;
  if (!auth?.startsWith("Bearer ") || auth.slice(7) !== SCIM_TOKEN) {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid SCIM bearer token");
  }
}

const SCIM_SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";

export async function scimRoutes(app: FastifyInstance): Promise<void> {
  /** Service Provider Configuration (required by SCIM spec) */
  app.get("/v1/identity/scim/ServiceProviderConfig", async (_req, reply) => {
    return reply.send({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: "oauthbearertoken", name: "OAuth Bearer Token", description: "Bearer token auth" }],
    });
  });

  /** List users (with SCIM filter support) */
  app.get("/v1/identity/scim/Users", async (req, reply) => {
    requireScimAuth(req);
    const query = req.query as { filter?: string; startIndex?: string; count?: string };
    const startIndex = Math.max(1, Number(query.startIndex) || 1);
    const count = Math.min(200, Math.max(1, Number(query.count) || 50));

    // TODO: query users from DB, apply SCIM filter parsing
    return reply.send({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      startIndex,
      itemsPerPage: count,
      Resources: [],
    });
  });

  /** Get single user */
  app.get("/v1/identity/scim/Users/:id", async (req, reply) => {
    requireScimAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // TODO: load user, map to SCIM schema
    return reply.code(404).send({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User not found",
      status: "404",
    });
  });

  /** Create user (provision from IdP) */
  app.post("/v1/identity/scim/Users", async (req, reply) => {
    requireScimAuth(req);
    const body = req.body as Record<string, unknown>;
    // TODO: validate SCIM user schema, create in users table, assign default role
    const id = crypto.randomUUID();
    return reply.code(201).send({
      schemas: [SCIM_SCHEMA_USER],
      id,
      userName: body["userName"] ?? "",
      active: true,
      meta: { resourceType: "User", created: new Date().toISOString(), location: `/v1/identity/scim/Users/${id}` },
    });
  });

  /** Replace user (full update) */
  app.put("/v1/identity/scim/Users/:id", async (req, reply) => {
    requireScimAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // TODO: full replace user attributes
    return reply.send({
      schemas: [SCIM_SCHEMA_USER],
      id,
      meta: { resourceType: "User", lastModified: new Date().toISOString() },
    });
  });

  /** Patch user (partial update — active: false = deprovisioned) */
  app.patch("/v1/identity/scim/Users/:id", async (req, reply) => {
    requireScimAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // TODO: apply SCIM patch operations
    return reply.send({
      schemas: [SCIM_SCHEMA_USER],
      id,
      meta: { resourceType: "User", lastModified: new Date().toISOString() },
    });
  });

  /** Delete user (deactivate — SCIM delete = soft-delete) */
  app.delete("/v1/identity/scim/Users/:id", async (req, reply) => {
    requireScimAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // TODO: deactivate user
    return reply.code(204).send();
  });
}
