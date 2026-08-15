"use client";
/**
 * NotificationPanel
 *
 * Re-exports NotificationBell as NotificationPanel so callers can import
 * from this module path.  Both leave-approval and payroll-run events are
 * surfaced by the shared SSE panel; no additional configuration is needed.
 *
 * Usage:
 *   import { NotificationPanel } from "@/app/_components/notifications/NotificationPanel";
 *   <NotificationPanel />
 */
export { NotificationBell as NotificationPanel } from "../NotificationBell";
export type { Notification as NotifItem } from "../NotificationBell";
