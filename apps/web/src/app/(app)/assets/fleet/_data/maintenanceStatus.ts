import { daysUntilIST } from "@/lib/formatters";

/**
 * GAP-ASSETS-FLEET-MAINTENANCE-05: a scheduled job whose date has passed is
 * shown as "overdue" (by date only -- the odometer threshold is stored but not
 * evaluated by the service). Any other status is passed through unchanged.
 */
export function displayStatus(status: string, scheduledDate: string): string {
  if (status !== "scheduled") return status;
  const days = daysUntilIST(scheduledDate || null);
  return days !== null && days < 0 ? "overdue" : status;
}
