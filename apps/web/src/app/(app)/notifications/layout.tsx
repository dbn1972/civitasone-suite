import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

/**
 * SF-20: module gate for /notifications. notification is a platform module (never disabled), so
 * this is the entitlement hook rather than a blocker today.
 *
 * Deliberately NO role gate at this level: the hub and /notifications/list are every signed-in
 * user's own inbox (GET /notifications/notifications is recipient-scoped in notification-service
 * with no requireRole), and GET /notifications/templates is also open. The narrower areas keep
 * their own segment layouts: compose (send roles) and deliveries (read roles).
 */
export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="notification">{children}</ModuleGate>;
}
