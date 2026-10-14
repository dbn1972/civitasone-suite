import { z } from "zod";

/**
 * Client-side mirror of hrms-service's `separateBody`
 * (services/hrms-service/src/modules/lifecycle/validators.ts, used by
 * PATCH /v1/hrms/employees/:id/separate): effectiveDate YYYY-MM-DD,
 * lastWorkingDate optional YYYY-MM-DD, encashmentDays a non-negative integer
 * (default 0), remarks max 1000. separationType is a closed enum chosen from a
 * <select> fed by SEPARATION_TYPES, so it is not re-checked here. The server
 * stays the authority; this only surfaces the obvious rejections inline.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const separationSchema = z.object({
  effectiveDate: z.string().regex(DATE, "effectiveDateRequired"),
  lastWorkingDate: z
    .string()
    .refine((v) => v === "" || DATE.test(v), "lastWorkingDateInvalid"),
  encashmentDays: z.number().int("encashmentWhole").nonnegative("encashmentNegative"),
  remarks: z.string().max(1000, "remarksMax1000"),
});

export type SeparationErrors = Partial<Record<keyof z.infer<typeof separationSchema>, string>>;

export function validateSeparation(input: {
  effectiveDate: string;
  lastWorkingDate: string;
  encashmentDays: string;
  remarks: string;
}): SeparationErrors {
  const days = input.encashmentDays.trim() === "" ? 0 : Number(input.encashmentDays);
  const parsed = separationSchema.safeParse({
    effectiveDate: input.effectiveDate,
    lastWorkingDate: input.lastWorkingDate,
    encashmentDays: Number.isFinite(days) ? days : Number.NaN,
    remarks: input.remarks.trim(),
  });
  if (parsed.success) return {};
  const errors: SeparationErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof SeparationErrors;
    if (key && !errors[key]) errors[key] = key === "encashmentDays" && issue.code === "invalid_type" ? "encashmentWhole" : issue.message;
  }
  return errors;
}
