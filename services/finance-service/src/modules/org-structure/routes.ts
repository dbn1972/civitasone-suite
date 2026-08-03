/**
 * ERP Org Structure CRUD routes — Legal Entity, Operating Unit, Cost Center, Profit Center.
 * These are master-data setup routes (used during tenant onboarding / org setup).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { legalEntities, operatingUnits, costCenters, profitCenters } from "./schema.js";
import * as commands from "./commands.js";

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
    const rows = await scopedRead((tx) => tx.select().from(legalEntities).where(eq(legalEntities.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/legal-entities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createLegalEntityBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createLegalEntity(ctx, body));
  });

  // ── Operating Units ──
  app.get("/v1/finance/operating-units", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(operatingUnits).where(eq(operatingUnits.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/operating-units", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createOperatingUnitBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createOperatingUnit(ctx, body));
  });

  // ── Cost Centers ──
  app.get("/v1/finance/cost-centers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(costCenters).where(eq(costCenters.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/cost-centers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createCostCenterBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCostCenter(ctx, body));
  });

  // ── Profit Centers ──
  app.get("/v1/finance/profit-centers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(profitCenters).where(eq(profitCenters.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/profit-centers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createProfitCenterBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createProfitCenter(ctx, body));
  });
}
