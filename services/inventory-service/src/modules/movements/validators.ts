import { z } from "zod";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const lineSchema = z.object({
  itemId:    z.string().uuid(),
  qty:       z.number().int().positive().max(10_000_000),
  rateMinor: z.number().int().nonnegative().default(0),
  currency:  z.string().length(3).default("INR"),
});

const lineCountedSchema = z.object({
  itemId:     z.string().uuid(),
  countedQty: z.number().int().nonnegative().max(10_000_000),
});

// ── HTTP request bodies ──────────────────────────────────────────────────

export const createReceiptBody = z.object({
  toStoreId:   z.string().uuid(),
  postingDate: z.string().regex(datePattern),
  refDoc:      z.string().max(64).optional(),
  refNo:       z.string().max(64).optional(),
  notes:       z.string().max(512).optional(),
  lines:       z.array(lineSchema).min(1).max(500),
});
export type CreateReceiptBody = z.infer<typeof createReceiptBody>;

export const createIssueBody = z.object({
  fromStoreId: z.string().uuid(),
  postingDate: z.string().regex(datePattern),
  refDoc:      z.string().max(64).optional(),
  refNo:       z.string().max(64).optional(),
  reasonCode:  z.string().max(32).optional(),
  notes:       z.string().max(512).optional(),
  lines:       z.array(lineSchema).min(1).max(500),
});
export type CreateIssueBody = z.infer<typeof createIssueBody>;

export const createTransferBody = z.object({
  fromStoreId: z.string().uuid(),
  toStoreId:   z.string().uuid(),
  postingDate: z.string().regex(datePattern),
  refNo:       z.string().max(64).optional(),
  notes:       z.string().max(512).optional(),
  lines:       z.array(lineSchema).min(1).max(500),
}).refine((b) => b.fromStoreId !== b.toStoreId, {
  message: "fromStoreId and toStoreId must differ",
  path: ["toStoreId"],
});
export type CreateTransferBody = z.infer<typeof createTransferBody>;

export const createAdjustmentBody = z.object({
  storeId:     z.string().uuid(),
  postingDate: z.string().regex(datePattern),
  reasonCode:  z.string().min(1).max(32),
  notes:       z.string().max(512).optional(),
  lines:       z.array(lineCountedSchema).min(1).max(500),
});
export type CreateAdjustmentBody = z.infer<typeof createAdjustmentBody>;

// ── Consume-boundary payloads (validated before any DB mutation) ──────────

const withMeta = { id: z.string().uuid(), tenantId: z.string().uuid() };

export const receiptPayload    = createReceiptBody.extend(withMeta);
export const issuePayload      = createIssueBody.extend(withMeta);
export const adjustmentPayload = createAdjustmentBody.extend(withMeta);
// transfer body uses .refine() → rebuild the object schema with meta then refine.
export const transferPayload = z.object({
  ...withMeta,
  fromStoreId: z.string().uuid(),
  toStoreId:   z.string().uuid(),
  postingDate: z.string().regex(datePattern),
  refNo:       z.string().max(64).optional(),
  notes:       z.string().max(512).optional(),
  lines:       z.array(lineSchema).min(1).max(500),
}).refine((b) => b.fromStoreId !== b.toStoreId, { message: "stores must differ", path: ["toStoreId"] });

/** GRN payload emitted by procurement-service (consumed, not owned). */
export const grnAcceptedPayload = z.object({
  grnId:       z.string(),
  toStoreId:   z.string().uuid().optional(),
  storeId:     z.string().uuid().optional(),
  postingDate: z.string().regex(datePattern).optional(),
  items: z.array(z.object({
    itemId:      z.string().uuid(),
    acceptedQty: z.number().int().positive(),
    rateMinor:   z.number().int().nonnegative().default(0),
    currency:    z.string().length(3).default("INR"),
    itemType:    z.string().optional(),
  })).default([]),
});

// ── Query params ──────────────────────────────────────────────────────────

export const balanceQueryParams = z.object({
  itemId:  z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  limit:   z.coerce.number().int().positive().max(500).default(100),
  offset:  z.coerce.number().int().nonnegative().default(0),
});

export const ledgerQueryParams = z.object({
  itemId:  z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  from:    z.string().regex(datePattern).optional(),
  to:      z.string().regex(datePattern).optional(),
  limit:   z.coerce.number().int().positive().max(500).default(100),
  offset:  z.coerce.number().int().nonnegative().default(0),
});

export const lowStockQueryParams = z.object({
  limit:  z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});
