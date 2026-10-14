import { z } from "zod";

/**
 * Client-side mirrors of hrms-service's request bodies
 * (services/hrms-service/src/modules/employee/validators.ts):
 *  - `confirmEmployeeBody` (PATCH /v1/hrms/employees/:id/confirm):
 *    confirmationDate YYYY-MM-DD, orderRef 1-64 chars, remark max 500 (the remark
 *    is the ConfirmDialog's own reason field, bounded by its maxReasonLength).
 *  - `probationExtensionBody` (PATCH .../probation-extension): newEndDate
 *    YYYY-MM-DD, orderRef max 128 (optional), reason 3-500 (dialog reason field).
 * Date-vs-record bounds (not before joining, strictly later than the current end)
 * stay where they already were. The server stays the authority.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const confirmSchema = z.object({
  confirmationDate: z.string().regex(DATE, "confirmationDateRequired"),
  orderRef: z.string().trim().min(1, "orderRefRequired").max(64, "orderRefMax64"),
});

export const extendSchema = z.object({
  newEndDate: z.string().regex(DATE, "newEndDateRequired"),
  orderRef: z.string().trim().max(128, "orderRefMax128"),
});

type Errors<K extends string> = Partial<Record<K, string>>;

function collect<K extends string>(res: { success: true } | { success: false; error: z.ZodError }): Errors<K> {
  if (res.success) return {};
  const errors: Errors<K> = {};
  for (const issue of res.error.issues) {
    const key = issue.path[0] as K;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function validateConfirm(input: { confirmationDate: string; orderRef: string }): Errors<"confirmationDate" | "orderRef"> {
  return collect(confirmSchema.safeParse(input));
}

export function validateExtend(input: { newEndDate: string; orderRef: string }): Errors<"newEndDate" | "orderRef"> {
  return collect(extendSchema.safeParse(input));
}
