import { z } from "zod";

/**
 * Client-side mirror of crm-service `createActivityBody`
 * (services/crm-service/src/modules/activities/validators.ts): text is required
 * (1-2000 chars), subject is optional (max 200). Keeping the limits identical
 * means an over-long note is caught inline instead of after a 400 round trip.
 * The ACTIVITY type list is not re-validated here: the forms offer a fixed
 * <select> of valid types.
 */
export const ACTIVITY_TEXT_MAX = 2000;
export const ACTIVITY_SUBJECT_MAX = 200;

export const activityFormSchema = z.object({
  subject: z.string().trim().max(ACTIVITY_SUBJECT_MAX, `Subject must be ${ACTIVITY_SUBJECT_MAX} characters or fewer.`),
  text: z
    .string()
    .trim()
    .min(1, "Enter the notes for this activity.")
    .max(ACTIVITY_TEXT_MAX, `Notes must be ${ACTIVITY_TEXT_MAX} characters or fewer.`),
});

export type ActivityFormErrors = { subject?: string; text?: string };

/** Field-keyed messages, or an empty object when the input is valid. */
export function validateActivityForm(input: { subject: string; text: string }): ActivityFormErrors {
  const parsed = activityFormSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: ActivityFormErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof ActivityFormErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
