import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
/** Paise as a non-negative integer string (never a float; bigint-safe over JSON). */
const paise = z.union([z.string().regex(/^\d{1,15}$/), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)])
  .transform((v) => String(v));

export const createOutsourcedBody = z.object({
  vendorName: z.string().trim().min(1).max(200),
  serviceCategory: z.string().trim().min(1).max(120),
  contractRef: z.string().trim().max(64).optional(),
  headcount: z.coerce.number().int().min(0).max(1_000_000),
  contractStart: isoDate,
  contractEnd: isoDate,
  contractValueMinor: paise.default("0"),
  remarks: z.string().trim().max(2000).optional(),
}).refine((b) => b.contractEnd >= b.contractStart, { message: "contractEnd must be on or after contractStart", path: ["contractEnd"] });

export const updateOutsourcedBody = z.object({
  headcount: z.coerce.number().int().min(0).max(1_000_000).optional(),
  contractEnd: isoDate.optional(),
  contractValueMinor: paise.optional(),
  status: z.enum(["active", "terminated"]).optional(),
  remarks: z.string().trim().max(2000).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

export const listOutsourcedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "terminated"]).optional(),
});

export const idParam = z.object({ id: z.string().uuid() });
export type CreateOutsourcedBody = z.infer<typeof createOutsourcedBody>;
export type UpdateOutsourcedBody = z.infer<typeof updateOutsourcedBody>;
