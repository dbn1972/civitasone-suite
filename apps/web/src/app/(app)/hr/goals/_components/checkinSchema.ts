import { z } from "zod";

/**
 * Client-side mirror of hrms-service's `goalCheckinSchema`
 * (services/hrms-service/src/modules/social/pulse-routes.ts -- POST
 * /v1/hrms/goals/:id/checkin): progress an integer 0-100, note max 500.
 * The server stays the authority.
 */
export const checkinSchema = z.object({
  progress: z
    .number({ invalid_type_error: "progressWhole" })
    .int("progressWhole")
    .min(0, "progressMin")
    .max(100, "progressMax"),
  note: z.string().max(500, "noteMax500"),
});

export type CheckinErrors = Partial<Record<keyof z.infer<typeof checkinSchema>, string>>;

export function validateCheckin(input: { progress: number; note: string }): CheckinErrors {
  const parsed = checkinSchema.safeParse({ progress: input.progress, note: input.note.trim() });
  if (parsed.success) return {};
  const errors: CheckinErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof CheckinErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
