/**
 * SCIM 2.0 module — mutations are CQRS (publish → 202); GETs remain sync reads.
 *
 * SEC-007: tenant scoping for every SCIM operation is resolved SOLELY from
 * the presented bearer token (resolveScimTenant, below) — a per-tenant
 * credential bound server-side at issuance in scim.scim_tokens. The
 * client-supplied x-tenant-id header plays NO role in that decision; it is
 * only read to log a mismatch. Previously this module used one global
 * SCIM_BEARER_TOKEN for every tenant and trusted x-tenant-id (falling back
 * to SCIM_TENANT_ID, then a hardcoded default) to pick which tenant's data
 * an operation touched — so any holder of the one global token could
 * provision/deprovision users in ANY tenant. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-007.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { HttpError, resolveContext, requireRole } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { users } from "../users/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import * as commands from "./commands.js";
import * as tokenRepo from "./token-repo.js";
import { sha256Hex, generateScimSecret, isUsable } from "./token-domain.js";
import { issueScimTokenBody, scimTokenIdParam } from "./token-validators.js";
import type { ScimTokenRow } from "./schema.js";

const SCIM_SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

// Mirrors commands.ts's SCIM_SYSTEM_ACTOR_ID sentinel convention — used only
// for the one-time legacy-token migration row (see bootstrapLegacyScimToken),
// which has no human actor.
const SCIM_LEGACY_ACTOR_ID = "00000000-0000-0000-0000-000000000001";

/**
 * SEC-007 — resolve which tenant a SCIM request may act on, from the
 * presented bearer token alone. Throws 401 if the token is missing, unknown,
 * revoked, or expired. The x-tenant-id header (if present) is NEVER trusted
 * for this decision — it is only compared, after the fact, purely to log a
 * mismatch signal (a misconfigured client, or an attempted attack).
 */
async function resolveScimTenant(req: {
  headers: Record<string, string | string[] | undefined>;
  log: { warn: (obj: Record<string, unknown>, msg: string) => void };
}): Promise<string> {
  const auth = req.headers.authorization as string | undefined;
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHENTICATED", "Missing bearer token");
  const presented = auth.slice(7);
  if (!presented) throw new HttpError(401, "UNAUTHENTICATED", "Missing bearer token");

  const hash = sha256Hex(presented);
  // No transaction wrapper needed: scim.scim_tokens deliberately carries no
  // RLS policy (migration 0022), so there is no app.tenant_id GUC for a
  // transaction to set here — see token-repo.ts's findBySecretHash for why.
  const row = await tokenRepo.findBySecretHash(db, hash);
  if (!row || !isUsable(row)) {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid SCIM bearer token");
  }

  const claimedTenant = req.headers["x-tenant-id"] as string | undefined;
  if (claimedTenant && claimedTenant !== row.tenantId) {
    req.log.warn(
      {
        event: "scim_tenant_header_mismatch",
        tokenId: row.id,
        boundTenantId: row.tenantId,
        claimedTenant,
      },
      "SEC-007: x-tenant-id header ignored — does not match this SCIM token's server-bound tenant",
    );
  }

  await tokenRepo.touchLastUsed(db, row.id, new Date());
  return row.tenantId;
}

/**
 * One-time, idempotent migration path: if a deployment still configures the
 * legacy single-tenant env vars (SCIM_BEARER_TOKEN + SCIM_TENANT_ID), seed a
 * scim.scim_tokens row binding that exact token to that exact tenant, so
 * existing integrations keep working WITHOUT ever trusting a client header
 * again — this legacy token is now correctly scoped to the one tenant it was
 * configured for, not every tenant. New tenants (or a rotation off the env
 * var) should use POST /identity/scim-tokens (scimTokenRoutes) instead.
 * No-ops when either var is unset, or when a row for that hash already exists.
 */
async function bootstrapLegacyScimToken(): Promise<void> {
  const legacyToken = process.env.SCIM_BEARER_TOKEN;
  const legacyTenant = process.env.SCIM_TENANT_ID;
  if (!legacyToken || !legacyTenant) return;

  const hash = sha256Hex(legacyToken);
  const existing = await tokenRepo.findBySecretHash(db, hash);
  if (existing) return;

  try {
    await tokenRepo.insert(db, {
      tenantId: legacyTenant,
      name: "legacy env-configured token (SCIM_BEARER_TOKEN)",
      tokenPrefix: "legacy_env",
      secretHash: hash,
      status: "active",
      createdBy: SCIM_LEGACY_ACTOR_ID,
    });
  } catch (err) {
    // Benign race: two instances of this service starting up concurrently
    // can both pass the `existing` check above before either inserts. The
    // unique index on secret_hash (migration 0022) makes the loser's insert
    // fail rather than duplicate the row — which is exactly the outcome we
    // want, so swallow ONLY that specific, expected error.
    const code = (err as { code?: string } | null)?.code;
    if (code !== "23505") throw err;
  }
}

function correlationId(req: { headers: Record<string, string | string[] | undefined>; id?: string }): string {
  return (req.headers["x-correlation-id"] as string) || req.id || "scim";
}

function toScimUser(row: {
  id: string;
  email: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    schemas: [SCIM_SCHEMA_USER],
    id: row.id,
    userName: row.email,
    name: {
      formatted: row.name,
      givenName: row.name.split(" ")[0] ?? "",
      familyName: row.name.split(" ").slice(1).join(" ") ?? "",
    },
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

function toScimTokenView(row: ScimTokenRow) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    status: row.status,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

export async function scimRoutes(app: FastifyInstance): Promise<void> {
  await bootstrapLegacyScimToken();

  app.get("/v1/identity/scim/ServiceProviderConfig", async (_req, reply) => {
    return reply.send({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        { type: "oauthbearertoken", name: "OAuth Bearer Token", description: "Bearer token auth" },
      ],
    });
  });

  app.get("/v1/identity/scim/Users", async (req, reply) => {
    const tid = await resolveScimTenant(req);
    const query = req.query as { filter?: string; startIndex?: string; count?: string };
    const startIndex = Math.max(1, Number(query.startIndex) || 1);
    const count = Math.min(200, Math.max(1, Number(query.count) || 50));
    const offset = startIndex - 1;

    let rows;
    if (query.filter) {
      const match = query.filter.match(/userName\s+eq\s+"([^"]+)"/i);
      if (match?.[1]) {
        rows = await scopedRead((tx) =>
          tx
            .select()
            .from(users)
            .where(and(eq(users.tenantId, tid), ilike(users.email, match[1]!)))
            .limit(count)
            .offset(offset),
        );
      } else {
        rows = await scopedRead((tx) =>
          tx.select().from(users).where(eq(users.tenantId, tid)).limit(count).offset(offset),
        );
      }
    } else {
      rows = await scopedRead((tx) =>
        tx.select().from(users).where(eq(users.tenantId, tid)).limit(count).offset(offset),
      );
    }

    return reply.send({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: rows.length,
      startIndex,
      itemsPerPage: count,
      Resources: rows.map(toScimUser),
    });
  });

  app.get("/v1/identity/scim/Users/:id", async (req, reply) => {
    const tid = await resolveScimTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [row] = await scopedRead((tx) =>
      tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tid)))
        .limit(1),
    );
    if (!row) {
      return reply.code(404).send({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      });
    }
    return reply.send(toScimUser(row));
  });

  app.post("/v1/identity/scim/Users", async (req, reply) => {
    const tid = await resolveScimTenant(req);
    const body = req.body as {
      userName?: string;
      name?: { formatted?: string; givenName?: string; familyName?: string };
      emails?: Array<{ value: string }>;
    };
    const email = body.userName ?? body.emails?.[0]?.value ?? "";
    const name =
      body.name?.formatted ??
      [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ") ??
      email;
    if (!email) throw new HttpError(400, "INVALID_VALUE", "userName (email) is required");

    const accepted = await commands.scimCreateUser(tid, correlationId(req), { email, name });
    const now = new Date();
    return reply.code(202).send(
      toScimUser({
        id: accepted.id,
        email,
        name,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    );
  });

  app.put("/v1/identity/scim/Users/:id", async (req, reply) => {
    const tid = await resolveScimTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = req.body as {
      userName?: string;
      name?: { formatted?: string; givenName?: string; familyName?: string };
      active?: boolean;
      emails?: Array<{ value: string }>;
    };

    const email = body.userName ?? body.emails?.[0]?.value;
    const name =
      body.name?.formatted ?? [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ");
    const status = body.active === false ? "disabled" : body.active === true ? "active" : undefined;

    const patch: Record<string, unknown> = {};
    if (email) patch["email"] = email;
    if (name) patch["name"] = name;
    if (status) patch["status"] = status;

    const [existing] = await scopedRead((tx) =>
      tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tid)))
        .limit(1),
    );
    if (!existing) {
      return reply.code(404).send({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      });
    }

    await commands.scimReplaceUser(tid, correlationId(req), id, patch);
    return reply.code(202).send(
      toScimUser({
        ...existing,
        email: (email as string) ?? existing.email,
        name: (name as string) || existing.name,
        status: (status as string) ?? existing.status,
        updatedAt: new Date(),
      }),
    );
  });

  app.patch("/v1/identity/scim/Users/:id", async (req, reply) => {
    const tid = await resolveScimTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = req.body as { Operations?: Array<{ op: string; path?: string; value?: unknown }> };

    const ops = body.Operations ?? [];
    const patch: Record<string, unknown> = {};

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

    const [existing] = await scopedRead((tx) =>
      tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tid)))
        .limit(1),
    );
    if (!existing) {
      return reply.code(404).send({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      });
    }

    await commands.scimPatchUser(tid, correlationId(req), id, patch);
    return reply.code(202).send(
      toScimUser({
        ...existing,
        email: (patch["email"] as string) ?? existing.email,
        name: (patch["name"] as string) ?? existing.name,
        status: (patch["status"] as string) ?? existing.status,
        updatedAt: new Date(),
      }),
    );
  });

  app.delete("/v1/identity/scim/Users/:id", async (req, reply) => {
    const tid = await resolveScimTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const [existing] = await scopedRead((tx) =>
      tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tid)))
        .limit(1),
    );
    if (!existing) {
      return reply.code(404).send({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      });
    }

    await commands.scimDeleteUser(tid, correlationId(req), id);
    return reply.code(202).send({ id, status: "accepted" });
  });
}

/**
 * SEC-007 — admin-facing lifecycle management for per-tenant SCIM tokens.
 * Normal JWT/ctx auth (NOT the SCIM bearer scheme) — an admin can only ever
 * issue/list/revoke tokens for their OWN tenant (ctx.tenantId), mirroring
 * apikeys/routes.ts's apiKeyRoutes.
 */
export async function scimTokenRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/scim-tokens", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = issueScimTokenBody.parse(req.body);

    const { tokenPrefix, fullToken, secretHash } = generateScimSecret();
    const id = randomUUID();
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    await tokenRepo.insert(db, {
      id,
      tenantId: ctx.tenantId,
      name: body.name,
      tokenPrefix,
      secretHash,
      status: "active",
      expiresAt,
      createdBy: ctx.actorId,
    });

    // Plaintext returned exactly once; never persisted or logged.
    return reply.code(201).send({ id, tokenPrefix, token: fullToken, status: "active" });
  });

  app.get("/identity/scim-tokens", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const rows = await tokenRepo.listByTenant(ctx.tenantId);
    return reply.send(rows.map(toScimTokenView));
  });

  app.post("/identity/scim-tokens/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = scimTokenIdParam.parse(req.params);
    const existing = await tokenRepo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "scim token not found");
    await tokenRepo.revoke(ctx.tenantId, id);
    return reply.send({ id, status: "revoked" });
  });
}
