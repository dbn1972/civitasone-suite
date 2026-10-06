import type { ReactNode } from "react";
import { requireAnyRole, NOTIFICATION_SEND_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-NOTIFICATIONS-COMPOSE-01: sending a notification to an arbitrary
 * recipient is a spam/phishing-capable action, so the compose screen is
 * restricted to the roles notification-service lets send
 * (NOTIFICATION_SEND_ROLES — mirrors modules/deliveries/routes.ts
 * NOTIFY_SEND_ROLES). This is the UI gate; POST /notifications/send stays the
 * real authority (requireRole(NOTIFY_SEND_ROLES) returns 403 for anyone else).
 * A viewer without a send role is redirected to the module hub rather than
 * shown a form whose submit is guaranteed to 403.
 */
export default function ComposeLayout({ children }: { children: ReactNode }) {
  requireAnyRole(NOTIFICATION_SEND_ROLES, "/notifications");
  return <>{children}</>;
}
