import { z } from "zod";

/**
 * Client-side mirror of hrms-service's onboarding-task create body
 * (services/hrms-service/src/modules/lifecycle/onboarding-routes.ts,
 * POST /v1/hrms/employees/:id/onboarding-tasks): title 1-200, dueByDay an
 * integer 1-365. (`assignedTo` is optional server-side and not collected here.)
 * The server stays the authority.
 */
export const addTaskSchema = z.object({
  title: z.string().trim().min(1, "Enter a task title.").max(200, "Task title must be 200 characters or fewer."),
  dueByDay: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 365, "Due day must be a whole number from 1 to 365."),
});

export type AddTaskErrors = Partial<Record<keyof z.infer<typeof addTaskSchema>, string>>;

export function validateAddTask(input: Record<keyof z.infer<typeof addTaskSchema>, string>): AddTaskErrors {
  const parsed = addTaskSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: AddTaskErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof AddTaskErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
