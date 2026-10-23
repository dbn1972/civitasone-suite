import { daysUntilIST } from "@/lib/formatters";

/**
 * GAP-ASSETS-FLEET-MAINTENANCE-05: a scheduled job is shown as "overdue" when its
 * date has passed OR the vehicle's odometer has reached the job's odometer
 * threshold (`odometerExceeded`, evaluated by asset-service against the vehicle's
 * current reading). Any other status is passed through unchanged.
 */
export function displayStatus(status: string, scheduledDate: string, odometerExceeded = false): string {
  if (status !== "scheduled") return status;
  if (odometerExceeded) return "overdue";
  const days = daysUntilIST(scheduledDate || null);
  return days !== null && days < 0 ? "overdue" : status;
}
