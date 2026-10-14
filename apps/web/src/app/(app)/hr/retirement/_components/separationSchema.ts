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
  effectiveDate: z.string().regex(DATE, "Enter the effective date."),
  lastWorkingDate: z
    .string()
    .refine((v) => v === "" || DATE.test(v), "Enter a valid last working date."),
  encashmentDays: z.number().int("Enter a whole number of days.").nonnegative("Encashment days cannot be negative."),
  remarks: z.string().max(1000, "Remarks must be 1000 characters or fewer."),
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
    if (key && !errors[key]) errors[key] = key === "encashmentDays" && issue.code === "invalid_type" ? "Enter a whole number of days." : issue.message;
  }
  return errors;
}
