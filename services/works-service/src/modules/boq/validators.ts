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

/**
 * GAP-WORKS-BOQ-NEW-05: a BoQ rate is a strictly positive amount of paise. zMoneyMinorString alone accepts "0" and
 * "-5", which produced a zero or NEGATIVE amountMinor that then flowed into the work total, the recapitulation and
 * the measured-value ceiling bills are checked against. The refinement runs on the already-normalised digit string,
 * so no number ever touches floating point.
 */
export const boqRateSchema = zMoneyMinorString.refine((minor) => BigInt(minor) > 0n, "rate must be greater than zero");

export const addBoqItemSchema = z.object({
  workId: z.string().uuid(),
  srItemId: z.string().uuid().optional(),
  itemDescription: z.string().min(1).max(1024),
  itemCode: z.string().max(64).optional(),
  unit: z.string().min(1).max(64),
  rate: boqRateSchema,
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
  rate: boqRateSchema.optional(),
  // Same rule as on add: a zero or negative quantity on an edit would produce a zero/negative amountMinor.
  quantity: boqQuantitySchema.optional(),
  itemDescription: z.string().max(1024).optional(),
  unit: z.string().max(64).optional(),
  remarks: z.string().max(2048).optional(),
});

export const deleteBoqItemSchema = z.object({
  id: z.string().uuid(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });
/** GAP-WORKS-BOQ-WORKID-05: the :workId of the per-work reads reaches a uuid column, so it is validated first. */
export const workIdParamSchema = z.object({ workId: z.string().uuid() });
