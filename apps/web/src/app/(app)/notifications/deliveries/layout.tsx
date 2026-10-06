import type { ReactNode } from "react";
import { NOTIFICATION_READ_ROLES, requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * GAP-NOTIFICATIONS-DELIVERIES-01 / -DETAIL-01: the delivery log is a
 * tenant-wide record of who was contacted and where (DPDP personal data), so
 * reading it is restricted to the roles notification-service lets read
 * (NOTIFY_READ_ROLES = send roles + audit_officer — see
 * modules/deliveries/routes.ts). This is the UI gate; the service's
 * requireRole(NOTIFY_READ_ROLES) on GET /notifications/deliveries[/:id] stays
 * the authority (403 for anyone else). A viewer without a read role is
 * redirected to the module hub.
 */
export default function DeliveriesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(NOTIFICATION_READ_ROLES, "/notifications");
  return <>{children}</>;
}
