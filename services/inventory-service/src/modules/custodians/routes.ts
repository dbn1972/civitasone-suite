/**
 * Custodian routes — store custodian assignment.
 *
 * POST   /v1/inventory/custodians              — create assignment (CQRS: 202 Accepted)
 * GET    /v1/inventory/stores/:id/custodians   — list by store
 * GET    /v1/inventory/custodians              — list all (tenant-scoped)
 *
 * GAP2-INVENTORY-CUSTODIANS-01: the create no longer writes Postgres in the
 * route handler and no longer skips auditing. It publishes a command; the
 * consumer applies the insert and emits an audit event in the same transaction.
 */
import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { scopedRead } from "../../shared/db.js";
import { custodians } from "../items/schema.js";
import { resolveContext, requireRole, registerErrorHandler } from "../../shared/context.js";
import { createCustodianBody, idParam, custodianQueryParams } from "./validators.js";
import * as commands from "./commands.js";

const WRITE_ROLES    = ["inventory_admin", "super_admin"];
const READ_ALL_ROLES = ["inventory_admin", "super_admin", "audit_officer"];
const READ_STORE_ROLES = [
  "inventory_user", "inventory_manager", "inventory_admin",
  "super_admin", "audit_officer",
];

export async function custodianRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/inventory/custodians — CQRS write path (publish command, 202)
  app.post("/v1/inventory/custodians", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createCustodianBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCustodian(ctx, body));
  });

  // GET /v1/inventory/stores/:id/custodians
  app.get("/v1/inventory/stores/:id/custodians", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_STORE_ROLES);
    const { id } = idParam.parse(req.params);
    // scopedRead() (not a bare db.select()) so the TenantRouter wrapper sets the
    // app.tenant_id GUC — required for FORCE RLS to return any rows at all.
    const rows = await scopedRead((tx) => tx
      .select()
      .from(custodians)
      .where(and(eq(custodians.tenantId, ctx.tenantId), eq(custodians.storeId, id))));
    return reply.send({ data: rows });
  });

  // GET /v1/inventory/custodians
  app.get("/v1/inventory/custodians", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ALL_ROLES);
    const q = custodianQueryParams.parse(req.query);
    // scopedRead() (not a bare db.select()) so the TenantRouter wrapper sets the
    // app.tenant_id GUC — required for FORCE RLS to return any rows at all.
    const rows = await scopedRead((tx) => tx
      .select()
      .from(custodians)
      .where(eq(custodians.tenantId, ctx.tenantId))
      .limit(q.limit)
      .offset(q.offset));
    return reply.send({ data: rows });
  });

  registerErrorHandler(app);
}
