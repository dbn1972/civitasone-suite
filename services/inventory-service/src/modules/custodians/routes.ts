/**
 * Custodian routes — store custodian assignment (master data, no CQRS).
 *
 * POST   /v1/inventory/custodians              — create assignment
 * GET    /v1/inventory/stores/:id/custodians   — list by store
 * GET    /v1/inventory/custodians              — list all (tenant-scoped)
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { custodians } from "../items/schema.js";
import { resolveContext, requireRole, registerErrorHandler } from "../../shared/context.js";
import { createCustodianBody, idParam, custodianQueryParams } from "./validators.js";

const WRITE_ROLES    = ["inventory_admin", "super_admin"];
const READ_ALL_ROLES = ["inventory_admin", "super_admin", "audit_officer"];
const READ_STORE_ROLES = [
  "inventory_user", "inventory_manager", "inventory_admin",
  "super_admin", "audit_officer",
];

export async function custodianRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/inventory/custodians
  app.post("/v1/inventory/custodians", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createCustodianBody.parse(req.body);
    const id = randomUUID();
    // Wrap in db.transaction() so wrapWithTenantGuc sets app.tenant_id GUC (required by FORCE RLS WITH CHECK).
    await db.transaction(async (tx) => (tx as unknown as typeof db).insert(custodians).values({
      id,
      tenantId:      ctx.tenantId,
      storeId:       body.storeId,
      employeeRef:   body.employeeRef,
      designation:   body.designation ?? null,
      effectiveFrom: body.effectiveFrom,
      effectiveTo:   body.effectiveTo ?? null,
      status:        "active",
      createdBy:     ctx.actorId,
      updatedBy:     ctx.actorId,
    }));
    return reply.code(201).send({ id, status: "created" });
  });

  // GET /v1/inventory/stores/:id/custodians
  app.get("/v1/inventory/stores/:id/custodians", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_STORE_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await db
      .select()
      .from(custodians)
      .where(and(eq(custodians.tenantId, ctx.tenantId), eq(custodians.storeId, id)));
    return reply.send({ data: rows });
  });

  // GET /v1/inventory/custodians
  app.get("/v1/inventory/custodians", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ALL_ROLES);
    const q = custodianQueryParams.parse(req.query);
    const rows = await db
      .select()
      .from(custodians)
      .where(eq(custodians.tenantId, ctx.tenantId))
      .limit(q.limit)
      .offset(q.offset);
    return reply.send({ data: rows });
  });

  registerErrorHandler(app);
}
