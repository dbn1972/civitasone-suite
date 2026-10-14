import { z } from "zod";

/**
 * Client-side mirror of payroll-service's `createStructureBody`
 * (services/payroll-service/src/modules/payroll/validators.ts): name 1-128, description max 500.
 * `isDefault` is a checkbox. The server stays the authority. Messages are `hrFormErrors2` keys.
 */
export const structureSchema = z.object({
  name: z.string().trim().min(1, "structureNameRequired").max(128, "structureNameMax"),
  description: z.string().trim().max(500, "structureDescriptionMax"),
});

export type StructureErrors = Partial<Record<keyof z.infer<typeof structureSchema>, string>>;

export function validateStructure(input: z.infer<typeof structureSchema>): StructureErrors {
  const parsed = structureSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: StructureErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof StructureErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
