import { z } from "zod";
import { zMoneyMinorString } from "@civitasone/schemas";

/**
 * GAP-WORKS-BOQ-NEW-04: a quantity may arrive as a decimal STRING (up to 4 dp, matching numeric(18,4)) so the browser
 * never round-trips it through a JS float; a plain positive number is still accepted for existing callers. Either form
 * is normalised to a number for the domain layer.
 */
export const boqQuantitySchema = z
  .union([z.number().positive(), z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, "quantity must be a decimal with up to 4 places")])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .refine((n) => n > 0, "quantity must be positive");

export const addBoqItemSchema = z.object({
  workId: z.string().uuid(),
  srItemId: z.string().uuid().optional(),
  itemDescription: z.string().min(1).max(1024),
  itemCode: z.string().max(64).optional(),
  unit: z.string().min(1).max(64),
  rate: zMoneyMinorString,
  quantity: boqQuantitySchema,
  numberVal: z.number().optional(),
  lengthVal: z.number().optional(),
  breadthVal: z.number().optional(),
  depthVal: z.number().optional(),
  scopeId: z.string().uuid().optional(),
  remarks: z.string().max(2048).optional(),
});

export const recapitulateSchema = z.object({
  workId: z.string().uuid(),
  contingencyPercent: z.number().min(0).max(100),
  turnoverTaxPercent: z.number().min(0).max(100),
  workChargePercent: z.number().min(0).max(100),
  qualityControlPercent: z.number().min(0).max(100),
  centagePercent: z.number().min(0).max(100),
  otherCharges: zMoneyMinorString.optional(),
});

export const updateBoqItemSchema = z.object({
  id: z.string().uuid(),
  rate: zMoneyMinorString.optional(),
  quantity: z.number().optional(),
  itemDescription: z.string().max(1024).optional(),
  unit: z.string().max(64).optional(),
  remarks: z.string().max(2048).optional(),
});

export const deleteBoqItemSchema = z.object({
  id: z.string().uuid(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });
