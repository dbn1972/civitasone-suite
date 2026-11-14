import { z } from "zod";

/**
 * S8-G4 -- request shapes for /v1/hrms/admin/grade-bands.
 *
 * Money is carried in minor units (paise) as a non-negative integer or a digit string (a string keeps
 * values above 2^53 exact); the API always answers with strings so JSON never loses precision.
 */
const MAX_MINOR_DIGITS = 15; // 9,99,99,99,99,99,999.99 rupees: far above any CTC, still exact in a bigint
const minor = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(new RegExp(`^\\d{1,${MAX_MINOR_DIGITS}}$`), "Enter a whole amount in paise (digits only)."),
]).transform((v) => BigInt(v));

/** Band codes are labels people print and say aloud: C2, T3, M2, Sr-Mgr. Stored upper-case, no spaces. */
const bandCode = z.string().trim().min(1, "Band code is required.").max(16, "Band code must be at most 16 characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, digits, '.', '_' or '-' only.")
  .transform((v) => v.toUpperCase());

const fields = {
  code:         bandCode,
  name:         z.string().trim().min(2, "Band name must be at least 2 characters.").max(120),
  rank:         z.number().int().min(1, "Rank must be 1 or more.").max(9999, "Rank must be at most 9999."),
  track:        z.string().trim().min(1).max(40).nullable().optional(),
  ctcMinMinor:  minor.nullable().optional(),
  ctcMaxMinor:  minor.nullable().optional(),
  noticeDays:   z.number().int().min(0).max(365).nullable().optional(),
};

const ctcRangeOk = (v: { ctcMinMinor?: bigint | null | undefined; ctcMaxMinor?: bigint | null | undefined }) =>
  v.ctcMinMinor == null || v.ctcMaxMinor == null || v.ctcMinMinor <= v.ctcMaxMinor;
const CTC_MSG = { message: "The minimum CTC cannot be above the maximum.", path: ["ctcMinMinor"] };

export const createGradeBandBody = z.object(fields).strict().refine(ctcRangeOk, CTC_MSG);
export type CreateGradeBandBody = z.infer<typeof createGradeBandBody>;

/** The code is the business key printed on payslips; it is immutable after creation. */
export const updateGradeBandBody = z.object({
  name:        fields.name.optional(),
  rank:        fields.rank.optional(),
  track:       fields.track,
  ctcMinMinor: fields.ctcMinMinor,
  ctcMaxMinor: fields.ctcMaxMinor,
  noticeDays:  fields.noticeDays,
  /** Optimistic lock: reject with 409 when the row moved on since the screen loaded it. */
  expectedVersion: z.number().int().positive().optional(),
}).strict()
  .refine((v) => Object.keys(v).some((k) => k !== "expectedVersion"), { message: "nothing to update" })
  .refine(ctcRangeOk, CTC_MSG);
export type UpdateGradeBandBody = z.infer<typeof updateGradeBandBody>;

export const gradeBandListQuery = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});

export const idParam = z.object({ id: z.string().uuid() });
