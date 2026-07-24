/** zod validators — applied at the route boundary AND at the consume boundary. */
import { z } from "zod";

export const itemType = z.enum(["consumable", "fixed_asset", "service"]);
export const valuationMethod = z.enum(["WAVG", "FIFO", "STANDARD"]);

export const createCategoryBody = z.object({
  name:     z.string().min(1).max(200),
  code:     z.string().min(1).max(64),
  parentId: z.string().uuid().optional(),
});
export type CreateCategoryBody = z.infer<typeof createCategoryBody>;

export const createUomBody = z.object({
  name:   z.string().min(1).max(120),
  symbol: z.string().min(1).max(16),
});
export type CreateUomBody = z.infer<typeof createUomBody>;

export const createItemBody = z.object({
  name:            z.string().min(1).max(200),
  sku:             z.string().min(1).max(64).optional(),
  categoryId:      z.string().uuid().optional(),
  uomId:           z.string().uuid().optional(),
  itemType:        itemType.default("consumable"),
  reorderLevel:    z.number().int().nonnegative().max(1_000_000).default(0),
  reorderQty:      z.number().int().nonnegative().max(1_000_000).default(0),
  reorderMax:      z.number().int().nonnegative().max(1_000_000).default(0),
  valuationMethod: valuationMethod.default("WAVG"),
  unitCostMinor:   z.number().int().nonnegative().default(0),
  currency:        z.string().length(3).default("INR"),
  // HSN/GST (SVC-051)
  hsnCode:         z.string().min(2).max(16).optional(),
  gstRate:         z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  taxClass:        z.string().max(32).optional(),
  // Shelf life / tracking (SVC-055)
  shelfLifeDays:   z.number().int().positive().optional(),
  requiresBatchTracking:  z.boolean().default(false),
  requiresSerialTracking: z.boolean().default(false),
});
export type CreateItemBody = z.infer<typeof createItemBody>;

/**
 * Update body carries the client's last-known `version` for optimistic locking.
 * The consumer rejects the write (VERSION_CONFLICT) if the row moved on.
 */
export const updateItemBody = z.object({
  version:         z.number().int().positive(),
  name:            z.string().min(1).max(200).optional(),
  sku:             z.string().min(1).max(64).nullable().optional(),
  status:          z.enum(["active", "inactive", "discontinued"]).optional(),
  categoryId:      z.string().uuid().nullable().optional(),
  uomId:           z.string().uuid().nullable().optional(),
  reorderLevel:    z.number().int().nonnegative().max(1_000_000).optional(),
  reorderQty:      z.number().int().nonnegative().max(1_000_000).optional(),
  reorderMax:      z.number().int().nonnegative().max(1_000_000).optional(),
  valuationMethod: valuationMethod.optional(),
  unitCostMinor:   z.number().int().nonnegative().optional(),
  hsnCode:         z.string().min(2).max(16).nullable().optional(),
  gstRate:         z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  taxClass:        z.string().max(32).nullable().optional(),
  shelfLifeDays:   z.number().int().positive().nullable().optional(),
  requiresBatchTracking:  z.boolean().optional(),
  requiresSerialTracking: z.boolean().optional(),
});
export type UpdateItemBody = z.infer<typeof updateItemBody>;

export const itemQueryParams = z.object({
  categoryId: z.string().uuid().optional(),
  status:     z.string().max(24).optional(),
  limit:      z.coerce.number().int().positive().max(200).default(50),
  offset:     z.coerce.number().int().nonnegative().default(0),
});

export const idParam = z.object({ id: z.string().uuid() });

// ── Substitutes ──────────────────────────────────────────────────────────
export const createSubstituteBody = z.object({
  itemId:           z.string().uuid(),
  substituteId:     z.string().uuid(),
  priority:         z.number().int().positive().default(1),
  conversionFactor: z.string().regex(/^\d+(\.\d{1,4})?$/).default("1.0"),
});
export type CreateSubstituteBody = z.infer<typeof createSubstituteBody>;

// ── Bins ──────────────────────────────────────────────────────────────────
export const createBinBody = z.object({
  storeId:  z.string().uuid(),
  code:     z.string().min(1).max(64),
  aisle:    z.string().max(16).optional(),
  rack:     z.string().max(16).optional(),
  shelf:    z.string().max(16).optional(),
  capacity: z.number().int().positive().optional(),
});
export type CreateBinBody = z.infer<typeof createBinBody>;

// ── Reservations ──────────────────────────────────────────────────────────
export const createReservationBody = z.object({
  itemId:    z.string().uuid(),
  storeId:   z.string().uuid(),
  qty:       z.number().int().positive(),
  refType:   z.string().min(1).max(32),
  refId:     z.string().uuid(),
  expiresAt: z.string().datetime().optional(),
});
export type CreateReservationBody = z.infer<typeof createReservationBody>;

export const releaseReservationBody = z.object({
  version: z.number().int().positive(),
});
export type ReleaseReservationBody = z.infer<typeof releaseReservationBody>;

// ── Goods Returns ─────────────────────────────────────────────────────────
export const createGoodsReturnBody = z.object({
  originalIssueId: z.string().uuid(),
  itemId:          z.string().uuid(),
  storeId:         z.string().uuid(),
  qty:             z.number().int().positive(),
  reason:          z.string().min(1).max(200),
});
export type CreateGoodsReturnBody = z.infer<typeof createGoodsReturnBody>;

export const qcInspectionBody = z.object({
  qcStatus:    z.enum(["passed", "failed", "conditional"]),
  qcNotes:     z.string().max(512).optional(),
  disposition: z.enum(["restock", "quarantine", "scrap"]),
});
export type QcInspectionBody = z.infer<typeof qcInspectionBody>;

/**
 * Payload schema validated by the consumer before it mutates Postgres.
 * (The bus parses the envelope; the consumer owns payload trust.)
 */
export const createItemPayload = createItemBody.extend({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
});
export const updateItemPayload = updateItemBody.extend({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
});
export const createCategoryPayload = createCategoryBody.extend({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
});
export const createUomPayload = createUomBody.extend({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
});
