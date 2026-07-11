import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

/**
 * Create a court/authority (§7 Court Master). `courtType` is validated as a
 * non-empty code here ONLY; it is NOT constrained to a hardcoded enum because
 * court types are tenant configuration (spec §5.2/§47 — "nothing hardcoded").
 * The config/metadata engine validates `courtType` against the tenant's
 * court-type catalogue at command time; this schema just enforces shape.
 */
export const createCourtBody = z.object({
  name:              z.string().trim().min(1).max(300),
  courtType:         z.string().trim().min(1).max(32),
  jurisdiction:      z.string().trim().max(2000).optional(),
  establishmentCode: z.string().trim().min(1).max(64).optional(),
  parentCourtId:     z.string().uuid().optional(),
  address:           z.string().trim().max(1000).optional(),
});
export type CreateCourtBody = z.infer<typeof createCourtBody>;

export const listCourtsQuery = z.object({
  courtType:     z.string().trim().max(32).optional(),
  parentCourtId: z.string().uuid().optional(),
  limit:         z.coerce.number().int().min(1).max(100).default(20),
  offset:        z.coerce.number().int().min(0).default(0),
});
export type ListCourtsQuery = z.infer<typeof listCourtsQuery>;

/** Create a bench under a court (§5.2 hearing capacity / presiding officer). */
export const createBenchBody = z.object({
  name:             z.string().trim().min(1).max(300),
  presidingJudgeId: z.string().uuid().optional(),
  benchType:        z.string().trim().max(32).optional(),
});
export type CreateBenchBody = z.infer<typeof createBenchBody>;
