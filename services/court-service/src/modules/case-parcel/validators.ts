import { z } from "zod";
import { SUBJECT_TYPES } from "./domain.js";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const parcelIdParam = z.object({ id: z.string().uuid() });

/**
 * Attach a parcel to a case. `surveyNumber` + optional `khasraNumber` identify the
 * revenue plot; `areaSqm` is an OPTIONAL non-negative integer number of square
 * metres (no floats). `subjectType` defaults to 'land' downstream when omitted.
 */
export const addParcelBody = z.object({
  surveyNumber: z.string().trim().min(1).max(64),
  khasraNumber: z.string().trim().max(64).optional(),
  khataNumber:  z.string().trim().max(64).optional(),
  village:      z.string().trim().min(1).max(120),
  tehsil:       z.string().trim().max(120).optional(),
  district:     z.string().trim().max(120).optional(),
  areaSqm:      z.coerce.number().int().min(0).optional(),
  subjectType:  z.enum(SUBJECT_TYPES).optional(),
  ownershipRef: z.string().trim().max(120).optional(),
  remarks:      z.string().trim().max(2000).optional(),
});
export type AddParcelBody = z.infer<typeof addParcelBody>;

/**
 * Update a parcel's mutable attributes or soft-detach it (`active: false`).
 * `expectedVersion` is the optimistic-lock token.
 */
export const updateParcelBody = z.object({
  areaSqm:         z.coerce.number().int().min(0).optional(),
  ownershipRef:    z.string().trim().max(120).optional(),
  remarks:         z.string().trim().max(2000).optional(),
  active:          z.boolean().optional(),
  expectedVersion: z.coerce.number().int().min(1),
});
export type UpdateParcelBody = z.infer<typeof updateParcelBody>;

/**
 * Reverse lookup — "which cases involve this survey number?" — across the tenant's
 * cases. `limit`/`offset` are coerced with sane bounds.
 */
export const searchQuery = z.object({
  surveyNumber: z.string().trim().min(1).max(64),
  limit:        z.coerce.number().int().min(1).max(200).default(50),
  offset:       z.coerce.number().int().min(0).default(0),
});
export type SearchQuery = z.infer<typeof searchQuery>;
