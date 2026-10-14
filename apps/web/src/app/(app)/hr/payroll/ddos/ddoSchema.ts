import { z } from "zod";

/**
 * Client-side mirror of payroll-service's `createDdoBody`
 * (services/payroll-service/src/modules/payroll/validators.ts): ddoCode 1-32, name 1-200.
 * `departmentIds` come only from the entity picker so they are not re-validated here.
 * The code format check is the existing DDO_CODE_RE. The server stays the authority.
 * Messages are `hrFormErrors2` keys.
 */
export const ddoSchema = z.object({
  ddoCode: z.string().trim().min(1, "ddoCodeRequired").max(32, "ddoCodeMax"),
  name: z.string().trim().min(1, "ddoNameRequired").max(200, "ddoNameMax"),
});

export type DdoErrors = Partial<Record<keyof z.infer<typeof ddoSchema>, string>>;

export function validateDdo(input: z.infer<typeof ddoSchema>, codePattern: RegExp): DdoErrors {
  const parsed = ddoSchema.safeParse(input);
  const errors: DdoErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof DdoErrors;
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  if (!errors.ddoCode && !codePattern.test(input.ddoCode.trim())) errors.ddoCode = "ddoCodeFormat";
  return errors;
}
