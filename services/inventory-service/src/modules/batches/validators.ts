/** zod validators — applied at the route boundary for batch and serial number operations. */
import { z } from "zod";

export const batchStatus = z.enum(["active", "expired", "depleted", "quarantine"]);
export const serialStatus = z.enum(["available", "issued", "returned", "scrapped"]);

export const createBatchBody = z.object({
  itemId:      z.string().uuid(),
  batchNumber: z.string().min(1).max(64),
  mfgDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  expiryDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  qty:         z.number().int().nonnegative().max(10_000_000).default(0),
});
export type CreateBatchBody = z.infer<typeof createBatchBody>;

export const updateBatchBody = z.object({
  version:     z.number().int().positive(),
  qty:         z.number().int().nonnegative().max(10_000_000).optional(),
  status:      batchStatus.optional(),
});
export type UpdateBatchBody = z.infer<typeof updateBatchBody>;

export const createSerialBody = z.object({
  itemId:       z.string().uuid(),
  batchId:      z.string().uuid().optional(),
  serialNumber: z.string().min(1).max(128),
});
export type CreateSerialBody = z.infer<typeof createSerialBody>;

export const issueFromBatchBody = z.object({
  batchId:     z.string().uuid(),
  qty:         z.number().int().positive().max(10_000_000),
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});
export type IssueFromBatchBody = z.infer<typeof issueFromBatchBody>;

export const batchQueryParams = z.object({
  itemId: z.string().uuid().optional(),
  status: z.string().max(24).optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const serialQueryParams = z.object({
  itemId:  z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  status:  z.string().max(24).optional(),
  limit:   z.coerce.number().int().positive().max(200).default(50),
  offset:  z.coerce.number().int().nonnegative().default(0),
});

export const idParam = z.object({ id: z.string().uuid() });

// ── Quarantine / Recall (SVC-055) ──────────────────────────────────────────
export const quarantineBatchBody = z.object({
  reason: z.string().min(1).max(500),
});
export type QuarantineBatchBody = z.infer<typeof quarantineBatchBody>;

export const recallBatchBody = z.object({
  reason:   z.string().min(1).max(500),
  severity: z.enum(["low", "medium", "high", "critical"]),
});
export type RecallBatchBody = z.infer<typeof recallBatchBody>;

// Consumer payload schemas
export const createBatchPayload = createBatchBody.extend({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
});

export const createSerialPayload = createSerialBody.extend({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
});

// ── Consumer payload schemas for quarantine / recall (SVC-055) ──────────────
// The route publishes { id: batchId, tenantId, reason } for quarantine and
// { id: recallId, batchId, tenantId, reason, severity } for recall.
export const quarantinePayload = z.object({
  id:       z.string().uuid(),
  tenantId: z.string().uuid(),
  reason:   z.string().min(1).max(500),
});

export const recallPayload = z.object({
  id:       z.string().uuid(),
  batchId:  z.string().uuid(),
  tenantId: z.string().uuid(),
  reason:   z.string().min(1).max(500),
  severity: z.enum(["low", "medium", "high", "critical"]),
});
