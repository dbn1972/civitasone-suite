/**
 * CM-001 — multiple addresses for contacts/accounts.
 *   GET    /v1/crm/addresses?ownerType=&ownerId=  — list (optionally filtered by owner)
 *   POST   /v1/crm/addresses                        — create (202, CQRS)
 *   PUT    /v1/crm/addresses/:id                     — amend (202, CQRS)
 *   DELETE /v1/crm/addresses/:id                     — remove (202, CQRS)
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import * as commands from "./commands.js";
import { createAddressBody, updateAddressBody, listAddressesQuery, idParam } from "./validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const SELECT_COLS = sql`
  id, owner_type AS "ownerType", owner_id AS "ownerId", address_type AS "addressType",
  line1, line2, city, state, pincode, country, is_primary AS "isPrimary",
  created_at AS "createdAt", updated_at AS "updatedAt", version`;

async function findAddress(tenantId: string, id: string): Promise<Record<string, unknown> | undefined> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT ${SELECT_COLS} FROM crm.addresses WHERE id = ${id} AND tenant_id = ${tenantId}
  `))) as unknown as Array<Record<string, unknown>>;
  return rows[0];
}

export async function addressRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/addresses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listAddressesQuery.parse(req.query);
    const ownerFilter = q.ownerType && q.ownerId
      ? sql`AND owner_type = ${q.ownerType} AND owner_id = ${q.ownerId}`
      : sql``;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT ${SELECT_COLS} FROM crm.addresses
      WHERE tenant_id = ${ctx.tenantId} ${ownerFilter}
      ORDER BY is_primary DESC, created_at DESC
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/crm/addresses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createAddressBody.parse(req.body);
    const id = commandId(ctx, `${COMMANDS.createAddress}:${body.ownerId}`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAddress(ctx, id, body));
  });

  app.put("/v1/crm/addresses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateAddressBody.parse(req.body);
    // 404 before accepting an update to a row that never existed for this tenant.
    if (!(await findAddress(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "address not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateAddress(ctx, id, body));
  });

  app.delete("/v1/crm/addresses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    if (!(await findAddress(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "address not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteAddress(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
