/**
 * identity-providers routes — the tenant-admin IdP (directory) and SSO (federated sign-in) registries.
 *   GET    /v1/admin/{idp|sso}/providers        -> { data, meta }  (client secrets never returned)
 *   POST   /v1/admin/{idp|sso}/providers        -> 202 (command; consumer writes)
 *   PUT    /v1/admin/{idp|sso}/providers/:id    -> 202
 *   DELETE /v1/admin/{idp|sso}/providers/:id    -> 202
 * Every route is tenant_admin or higher and tenant-scoped (FORCE RLS + explicit WHERE).
 * Response shapes are the shared contract in @civitasone/schemas/web (AdminIdp/SsoProviderListSchema),
 * which the web loaders getIdpProviders / getSsoProviders consume.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { sendValidated } from "@civitasone/schemas/validate";
import { AdminIdpProviderListSchema, AdminSsoProviderListSchema } from "@civitasone/schemas/web";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import * as commands from "./commands.js";
import { identityProviders, type IdentityProviderRow } from "./schema.js";
import { createBody, idParam, listQuery, updateBody, type ProviderKind } from "./validators.js";

const ROLES = [...TENANT_ADMIN_ROLES];
const READ_LIMIT = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } } as const;
const WRITE_LIMIT = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } } as const;

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return r.data;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toIdpView(r: IdentityProviderRow) {
  return {
    id: r.id, name: r.name, protocol: r.protocol, status: r.status, usersSynced: r.usersSynced,
    lastSync: iso(r.lastSyncAt), endpoint: r.endpoint, hasClientSecret: r.clientSecretCiphertext !== null,
  };
}

export function toSsoView(r: IdentityProviderRow) {
  return {
    id: r.id, name: r.name, protocol: r.protocol, entityId: r.entityId, status: r.status,
    lastSync: iso(r.lastSyncAt), hasClientSecret: r.clientSecretCiphertext !== null,
  };
}

async function exists(tenantId: string, kind: ProviderKind, id: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ id: identityProviders.id }).from(identityProviders)
    .where(and(eq(identityProviders.tenantId, tenantId), eq(identityProviders.kind, kind), eq(identityProviders.id, id))));
  return rows.length > 0;
}

async function nameTaken(tenantId: string, kind: ProviderKind, name: string, exceptId?: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ id: identityProviders.id }).from(identityProviders)
    .where(and(
      eq(identityProviders.tenantId, tenantId), eq(identityProviders.kind, kind),
      sql`lower(${identityProviders.name}) = lower(${name})`,
    )));
  return rows.some((r) => r.id !== exceptId);
}

function listHandler(kind: ProviderKind) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = parse(listQuery, req.query);
    const [rows, total] = await scopedRead(async (tx) => [
      await tx.select().from(identityProviders)
        .where(and(eq(identityProviders.tenantId, ctx.tenantId), eq(identityProviders.kind, kind)))
        .orderBy(asc(identityProviders.createdAt), asc(identityProviders.id))
        .limit(q.limit).offset(q.offset),
      await tx.select({ n: sql<number>`count(*)::int` }).from(identityProviders)
        .where(and(eq(identityProviders.tenantId, ctx.tenantId), eq(identityProviders.kind, kind))),
    ] as const);
    const meta = { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: Number(total[0]?.n ?? 0) };
    if (kind === "idp") sendValidated(reply, AdminIdpProviderListSchema, { data: rows.map(toIdpView), meta });
    else sendValidated(reply, AdminSsoProviderListSchema, { data: rows.map(toSsoView), meta });
    return reply;
  };
}

function createHandler(kind: ProviderKind) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = parse(createBody, req.body);
    if (await nameTaken(ctx.tenantId, kind, body.name)) {
      throw new HttpError(409, "PROVIDER_EXISTS", "a provider with this name already exists");
    }
    return reply.code(202).send(await commands.providerCreate(ctx, kind, body));
  };
}

function updateHandler(kind: ProviderKind) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = parse(idParam, req.params);
    const body = parse(updateBody, req.body);
    if (Object.keys(body).length === 0) throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    if (!(await exists(ctx.tenantId, kind, id))) throw new HttpError(404, "NOT_FOUND", "provider not found");
    if (body.name && (await nameTaken(ctx.tenantId, kind, body.name, id))) {
      throw new HttpError(409, "PROVIDER_EXISTS", "a provider with this name already exists");
    }
    return reply.code(202).send(await commands.providerUpdate(ctx, kind, id, body));
  };
}

function deleteHandler(kind: ProviderKind) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = parse(idParam, req.params);
    if (!(await exists(ctx.tenantId, kind, id))) throw new HttpError(404, "NOT_FOUND", "provider not found");
    return reply.code(202).send(await commands.providerDelete(ctx, kind, id));
  };
}

export async function identityProviderRoutes(app: FastifyInstance): Promise<void> {
  // Literal paths (not a loop over a template) so the static contract analyzer
  // (scripts/contract/screen-map.mjs) can see every route.
  app.get("/v1/admin/idp/providers", READ_LIMIT, listHandler("idp"));
  app.post("/v1/admin/idp/providers", WRITE_LIMIT, createHandler("idp"));
  app.put("/v1/admin/idp/providers/:id", WRITE_LIMIT, updateHandler("idp"));
  app.delete("/v1/admin/idp/providers/:id", WRITE_LIMIT, deleteHandler("idp"));

  app.get("/v1/admin/sso/providers", READ_LIMIT, listHandler("sso"));
  app.post("/v1/admin/sso/providers", WRITE_LIMIT, createHandler("sso"));
  app.put("/v1/admin/sso/providers/:id", WRITE_LIMIT, updateHandler("sso"));
  app.delete("/v1/admin/sso/providers/:id", WRITE_LIMIT, deleteHandler("sso"));
}
