import { z } from "zod";

/**
 * Client-side mirror of crm-service's service-request `createBody`
 * (services/crm-service/src/modules/service-requests/routes.ts): citizenName
 * 1-200, citizenPhone 3-32 when given, serviceType 1-64, subject 1-500,
 * description max 5000. Catches the obvious rejections inline instead of
 * after a round trip; the server stays the authority.
 */
export const followUpSchema = z.object({
  citizenName: z.string().trim().min(1, "Enter the contact name.").max(200, "Contact name must be 200 characters or fewer."),
  citizenPhone: z
    .string()
    .trim()
    .max(32, "Phone must be 32 characters or fewer.")
    .refine((v) => v.length === 0 || v.length >= 3, "Enter a valid phone number."),
  serviceType: z.string().trim().min(1, "Choose a service type.").max(64),
  subject: z.string().trim().min(1, "Enter a subject.").max(500, "Subject must be 500 characters or fewer."),
  description: z.string().max(5000, "Description must be 5000 characters or fewer."),
});

export type FollowUpErrors = Partial<Record<keyof z.infer<typeof followUpSchema>, string>>;

export function validateFollowUp(input: Record<keyof z.infer<typeof followUpSchema>, string>): FollowUpErrors {
  const parsed = followUpSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: FollowUpErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof FollowUpErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
