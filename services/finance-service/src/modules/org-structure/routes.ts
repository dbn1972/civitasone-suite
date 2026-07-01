/**
 * ERP Org Structure CRUD routes — Legal Entity, Operating Unit, Cost Center, Profit Center.
 * These are master-data setup routes (used during tenant onboarding / org setup).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { legalEntities, operatingUnits, costCenters, profitCenters } from "./schema.js";

const ADMIN_ROLES = ["finance_admin", "super_admin", "admin"];
const READER_ROLES = [...ADMIN_ROLES, "finance_officer", "audit_officer"];

// ── Validators ──────────────────────────────────────────────────────────────

const createLegalEntityBody = z.object({
  code:            z.string().min(1).max(20),
  name:            z.string().min(2).max(300),
  entityType:      z.enum(["company", "subsidiary", "ddo", "pao", "branch_office", "trust", "society", "cooperative", "llp", "proprietorship"]).default("company"),
  parentEntityId:  z.string().uuid().optional(),
  gstin:           z.string().length(15).optional(),
  pan:             z.string().length(10).optional(),
  tan:             z.string().length(10).optional(),
  cin:             z.string().max(21).optional(),
  currency:        z.string().length(3).default("INR"),
  fiscalYearStart: z.string().regex(/^\d{2}-\d{2}$/).default("04-01"),
  ddoCode:         z.string().max(12).optional(),
  paoCode:         z.string().max(12).optional(),
  treasuryCode:    z.string().max(20).optional(),
  locationId:      z.string().uuid().optional(),
  registeredAddress: z.string().max(500).optional(),
});

const createOperatingUnitBody = z.object({
  legalEntityId: z.string().uuid(),
  code:          z.string().min(1).max(20),
  name:          z.string().min(2).max(200),
  unitType:      z.enum(["branch", "plant", "warehouse", "office", "depot", "regional_office", "field_office"]).default("branch"),
  locationId:    z.string().uuid().optional(),
});

const createCostCenterBody = z.object({
  legalEntityId: z.string().uuid(),
  code:          z.string().min(1).max(20),
  name:          z.string().min(2).max(200),
  parentId:      z.string().uuid().optional(),
  departmentId:  z.string().uuid().optional(),
  managerId:     z.string().uuid().optional(),
});

const createProfitCenterBody = z.object({
  legalEntityId: z.string().uuid(),
  code:          z.string().min(1).max(20),
  name:          z.string().min(2).max(200),
  parentId:      z.string().uuid().optional(),
  segment:       z.string().max(100).optional(),
  managerId:     z.string().uuid().optional(),
});

// ── Routes ──────────────────────────────────────────────────────────────────

export async function orgStructureRoutes(app: FastifyInstance): Promise<void> {
  // ── Legal Entities ──
  app.get("/v1/finance/legal-entities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, ctx.tenantId));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/legal-entities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createLegalEntityBody.parse(req.body);
    const id = randomUUID();
    await db.insert(legalEntities).values({
      id, tenantId: ctx.tenantId, code: body.code, name: body.name,
      entityType: body.entityType,
      ...(body.parentEntityId ? { parentEntityId: body.parentEntityId } : {}),
      ...(body.gstin ? { gstin: body.gstin } : {}),
      ...(body.pan ? { pan: body.pan } : {}),
      ...(body.tan ? { tan: body.tan } : {}),
      ...(body.cin ? { cin: body.cin } : {}),
      currency: body.currency, fiscalYearStart: body.fiscalYearStart,
      ...(body.ddoCode ? { ddoCode: body.ddoCode } : {}),
      ...(body.paoCode ? { paoCode: body.paoCode } : {}),
      ...(body.treasuryCode ? { treasuryCode: body.treasuryCode } : {}),
      ...(body.locationId ? { locationId: body.locationId } : {}),
      ...(body.registeredAddress ? { registeredAddress: body.registeredAddress } : {}),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    return reply.code(201).send({ id, status: "created" });
  });

  // ── Operating Units ──
  app.get("/v1/finance/operating-units", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await db.select().from(operatingUnits).where(eq(operatingUnits.tenantId, ctx.tenantId));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/operating-units", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createOperatingUnitBody.parse(req.body);
    const id = randomUUID();
    await db.insert(operatingUnits).values({
      id, tenantId: ctx.tenantId, legalEntityId: body.legalEntityId,
      code: body.code, name: body.name, unitType: body.unitType,
      ...(body.locationId ? { locationId: body.locationId } : {}),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    return reply.code(201).send({ id, status: "created" });
  });

  // ── Cost Centers ──
  app.get("/v1/finance/cost-centers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await db.select().from(costCenters).where(eq(costCenters.tenantId, ctx.tenantId));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/cost-centers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createCostCenterBody.parse(req.body);
    const id = randomUUID();
    await db.insert(costCenters).values({
      id, tenantId: ctx.tenantId, legalEntityId: body.legalEntityId,
      code: body.code, name: body.name,
      ...(body.parentId ? { parentId: body.parentId } : {}),
      ...(body.departmentId ? { departmentId: body.departmentId } : {}),
      ...(body.managerId ? { managerId: body.managerId } : {}),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    return reply.code(201).send({ id, status: "created" });
  });

  // ── Profit Centers ──
  app.get("/v1/finance/profit-centers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await db.select().from(profitCenters).where(eq(profitCenters.tenantId, ctx.tenantId));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/profit-centers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createProfitCenterBody.parse(req.body);
    const id = randomUUID();
    await db.insert(profitCenters).values({
      id, tenantId: ctx.tenantId, legalEntityId: body.legalEntityId,
      code: body.code, name: body.name,
      ...(body.parentId ? { parentId: body.parentId } : {}),
      ...(body.segment ? { segment: body.segment } : {}),
      ...(body.managerId ? { managerId: body.managerId } : {}),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    return reply.code(201).send({ id, status: "created" });
  });
}
