/**
 * SCIM 2.0 (System for Cross-domain Identity Management) module.
 *
 * Implements RFC 7643/7644 for automated user provisioning and deprovisioning
 * from external IdPs (Azure AD, Okta, Google Workspace, MeriPehchaan).
 *
 * Auth: Bearer token (SCIM_BEARER_TOKEN env var) — separate from user JWTs.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { users } from "../users/schema.js";
import { eq, and, ilike } from "drizzle-orm";

const SCIM_TOKEN = process.env.SCIM_BEARER_TOKEN ?? "";
const SCIM_SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";

// The SCIM tenant is resolved from a header or a fixed mapping
const SCIM_TENANT_ID = process.env.SCIM_TENANT_ID ?? "";

function requireScimAuth(req: { headers: Record<string, string | string[] | undefined> }): void {
  if (!SCIM_TOKEN) throw new HttpError(503, "SCIM_DISABLED", "SCIM is not configured (set SCIM_BEARER_TOKEN)");
  const auth = req.headers.authorization as string | undefined;
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHENTICATED", "Missing bearer token");
  const provided = auth.slice(7);
  if (provided.length !== SCIM_TOKEN.length) throw new HttpError(401, "UNAUTHENTICATED", "Invalid SCIM bearer token");
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(SCIM_TOKEN))) {
      throw new HttpError(401, "UNAUTHENTICATED", "Invalid SCIM bearer token");
    }
  } catch {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid SCIM bearer token");
  }
}

function tenantId(req: { headers: Record<string, string | string[] | undefined> }): string {
  return (req.headers["x-tenant-id"] as string) || SCIM_TENANT_ID || "00000000-0000-0000-0000-000000000001";
}

function toScimUser(row: { id: string; email: string; name: string; status: string; createdAt: Date; updatedAt: Date }) {
  return {
    schemas: [SCIM_SCHEMA_USER],
    id: row.id,
    userName: row.email,
    name: { formatted: row.name, givenName: row.name.split(" ")[0] ?? "", familyName: row.name.split(" ").slice(1).join(" ") ?? "" },
    emails: [{ value: row.email, type: "work", primary: true }],
    active: row.status === "active",
    meta: {
      resourceType: "User",
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `/v1/identity/scim/Users/${row.id}`,
    },
  };
}

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

  /** List users with basic SCIM filter support */
  app.get("/v1/identity/scim/Users", async (req, reply) => {
    requireScimAuth(req);
    const tid = tenantId(req);
    const query = req.query as { filter?: string; startIndex?: string; count?: string };
    const startIndex = Math.max(1, Number(query.startIndex) || 1);
    const count = Math.min(200, Math.max(1, Number(query.count) || 50));
    const offset = startIndex - 1;

    // Basic filter: userName eq "email@example.com"
    let rows;
    if (query.filter) {
      const match = query.filter.match(/userName\s+eq\s+"([^"]+)"/i);
      if (match?.[1]) {
        rows = await db.select().from(users)
          .where(and(eq(users.tenantId, tid), ilike(users.email, match[1])))
          .limit(count).offset(offset);
      } else {
        rows = await db.select().from(users).where(eq(users.tenantId, tid)).limit(count).offset(offset);
      }
    } else {
      rows = await db.select().from(users).where(eq(users.tenantId, tid)).limit(count).offset(offset);
    }

    return reply.send({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: rows.length,
      startIndex,
      itemsPerPage: count,
      Resources: rows.map(toScimUser),
    });
  });

  /** Get single user by ID */
  app.get("/v1/identity/scim/Users/:id", async (req, reply) => {
    requireScimAuth(req);
    const tid = tenantId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [row] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tid))).limit(1);
    if (!row) {
      return reply.code(404).send({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      });
    }
    return reply.send(toScimUser(row));
  });

  /** Create user (provision from IdP) */
  app.post("/v1/identity/scim/Users", async (req, reply) => {
    requireScimAuth(req);
    const tid = tenantId(req);
    const body = req.body as { userName?: string; name?: { formatted?: string; givenName?: string; familyName?: string }; emails?: Array<{ value: string }> };
    const email = body.userName ?? body.emails?.[0]?.value ?? "";
    const name = body.name?.formatted ?? [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ") ?? email;

    if (!email) throw new HttpError(400, "INVALID_VALUE", "userName (email) is required");

    const id = randomUUID();
    await db.insert(users).values({
      id,
      tenantId: tid,
      email,
      name,
      status: "active",
      createdBy: "scim",
      updatedBy: "scim",
    });

    const [created] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return reply.code(201).send(toScimUser(created!));
  });

  /** Replace user (full update) */
  app.put("/v1/identity/scim/Users/:id", async (req, reply) => {
    requireScimAuth(req);
    const tid = tenantId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = req.body as { userName?: string; name?: { formatted?: string; givenName?: string; familyName?: string }; active?: boolean; emails?: Array<{ value: string }> };

    const email = body.userName ?? body.emails?.[0]?.value;
    const name = body.name?.formatted ?? [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ");
    const status = body.active === false ? "disabled" : body.active === true ? "active" : undefined;

    const patch: Record<string, unknown> = { updatedBy: "scim", updatedAt: new Date() };
    if (email) patch["email"] = email;
    if (name) patch["name"] = name;
    if (status) patch["status"] = status;

    await db.update(users).set(patch).where(and(eq(users.id, id), eq(users.tenantId, tid)));
    const [updated] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tid))).limit(1);
    if (!updated) return reply.code(404).send({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "User not found", status: "404" });
    return reply.send(toScimUser(updated));
  });

  /** Patch user (partial update — active: false = deprovision) */
  app.patch("/v1/identity/scim/Users/:id", async (req, reply) => {
    requireScimAuth(req);
    const tid = tenantId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = req.body as { Operations?: Array<{ op: string; path?: string; value?: unknown }> };

    const ops = body.Operations ?? [];
    const patch: Record<string, unknown> = { updatedBy: "scim", updatedAt: new Date() };

    for (const op of ops) {
      if (op.op === "replace" && op.path === "active" && op.value === false) {
        patch["status"] = "disabled";
      } else if (op.op === "replace" && op.path === "active" && op.value === true) {
        patch["status"] = "active";
      } else if (op.op === "replace" && op.path === "userName" && typeof op.value === "string") {
        patch["email"] = op.value;
      } else if (op.op === "replace" && op.path === "name.formatted" && typeof op.value === "string") {
        patch["name"] = op.value;
      }
    }

    await db.update(users).set(patch).where(and(eq(users.id, id), eq(users.tenantId, tid)));
    const [updated] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tid))).limit(1);
    if (!updated) return reply.code(404).send({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "User not found", status: "404" });
    return reply.send(toScimUser(updated));
  });

  /** Delete user (deactivate — SCIM delete = soft-delete/disable) */
  app.delete("/v1/identity/scim/Users/:id", async (req, reply) => {
    requireScimAuth(req);
    const tid = tenantId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const [existing] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tid))).limit(1);
    if (!existing) return reply.code(404).send({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "User not found", status: "404" });

    // Soft-delete: set status to disabled (user can no longer authenticate)
    await db.update(users).set({ status: "disabled", updatedBy: "scim", updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.tenantId, tid)));

    return reply.code(204).send();
  });
}
