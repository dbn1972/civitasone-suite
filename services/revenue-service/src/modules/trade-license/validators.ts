import { z } from "zod";

export const createTradeLicenseBody = z.object({
  licenseNo:      z.string().min(1).max(64),
  businessName:   z.string().min(1).max(256),
  proprietorName: z.string().min(1).max(256),
  address:        z.string().min(1),
  wardNo:         z.string().max(16).optional(),
  businessType:   z.enum(["retail", "manufacturing", "service", "hawker"]),
  category:       z.enum(["A", "B", "C"]).default("A"),
  issuedDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiryDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  feeMinor:       z.string().regex(/^\d+$/).default("0"),
});

export const renewTradeLicenseBody = z.object({
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feeMinor:   z.string().regex(/^\d+$/),
  version:    z.number().int().min(1),
});

export const cancelTradeLicenseBody = z.object({
  reason:  z.string().min(1).max(500),
  version: z.number().int().min(1),
});

export const recordPaymentBody = z.object({
  amountMinor: z.string().regex(/^\d+$/),
  channel:     z.enum(["online", "counter", "cheque", "dd"]),
  reference:   z.string().max(128).optional(),
  version:     z.number().int().min(1),
});

export const uuidParam = z.object({ id: z.string().uuid() });
export const paginationQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
