/**
 * Obligations — pure domain logic.
 *
 * Handles obligation reminder scheduling for contracts.
 * Reminders are generated at 30, 14, and 7 calendar days before the obligation due date.
 */

/** Standard reminder intervals (days before due date) */
export const REMINDER_DAYS = [30, 14, 7] as const;

export interface ReminderSchedule {
  daysBefore: number;
  reminderDate: string; // ISO date string (YYYY-MM-DD)
}

/**
 * Compute reminder dates for an obligation due date.
 * Only generates reminders for dates that are in the future relative to `today`.
 *
 * @param dueDate - The obligation due date (YYYY-MM-DD)
 * @param today - The reference date for filtering past reminders (YYYY-MM-DD)
 * @returns Array of reminder schedules with dates that are >= today
 */
export function computeReminderSchedule(dueDate: string, today: string): ReminderSchedule[] {
  const due = new Date(dueDate + "T00:00:00Z");
  const ref = new Date(today + "T00:00:00Z");

  const reminders: ReminderSchedule[] = [];

  for (const days of REMINDER_DAYS) {
    const reminderDate = new Date(due);
    reminderDate.setUTCDate(reminderDate.getUTCDate() - days);

    if (reminderDate >= ref) {
      reminders.push({
        daysBefore: days,
        reminderDate: reminderDate.toISOString().split("T")[0]!,
      });
    }
  }

  return reminders;
}

/** Valid obligation statuses */
export const OBLIGATION_STATUSES = ["pending", "in_progress", "completed", "overdue"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export class ObligationDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ObligationDomainError";
  }
}

/**
 * Validate obligation status transition.
 */
export function validateStatusTransition(current: ObligationStatus, next: ObligationStatus): boolean {
  const allowed: Record<ObligationStatus, ObligationStatus[]> = {
    pending: ["in_progress", "completed", "overdue"],
    in_progress: ["completed", "overdue"],
    overdue: ["completed"],
    completed: [],
  };
  return (allowed[current] ?? []).includes(next);
}
