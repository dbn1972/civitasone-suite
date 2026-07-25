import { z } from "zod";

export const addBoqItemSchema = z.object({
  workId: z.string().uuid(),
  srItemId: z.string().uuid().optional(),
  itemDescription: z.string().min(1).max(1024),
  itemCode: z.string().max(64).optional(),
  unit: z.string().min(1).max(64),
  rate: z.string().or(z.number()),
  quantity: z.number().positive(),
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
  otherCharges: z.string().or(z.number()).optional(),
});

export const updateBoqItemSchema = z.object({
  id: z.string().uuid(),
  rate: z.string().or(z.number()).optional(),
  quantity: z.number().optional(),
  itemDescription: z.string().max(1024).optional(),
  unit: z.string().max(64).optional(),
  remarks: z.string().max(2048).optional(),
});

export const deleteBoqItemSchema = z.object({
  id: z.string().uuid(),
});
