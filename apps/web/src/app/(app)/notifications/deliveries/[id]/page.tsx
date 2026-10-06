import { getSessionRoles, hasAnyRole, NOTIFICATION_SEND_ROLES } from "@/lib/auth/roleGuard";
import { DeliveryDetail } from "./DeliveryDetail";

/**
 * Thin server wrapper for the delivery detail screen. It resolves two role
 * capabilities from the session and hands them to the client component:
 *
 *  - canResend (GAP-NOTIFICATIONS-DELIVERIES-DETAIL-01): Resend issues a brand
 *    new POST /notifications/send, so it is offered only to roles that may send
 *    (NOTIFICATION_SEND_ROLES — mirrors the service's NOTIFY_SEND_ROLES). The
 *    service's send route stays the authority (403 for anyone else).
 *  - canSeeTechnicalDetail (GAP-NOTIFICATIONS-DELIVERIES-DETAIL-03): the raw
 *    provider error string may carry gateway internals, so it is collapsed into
 *    an admin-only "Technical detail" section; everyone else sees the
 *    catalogued, clerk-safe reason.
 *
 * The route itself is gated for read access by deliveries/layout.tsx.
 */
const ADMIN_ROLES = ["notification_admin", "super_admin", "platform_admin", "tenant_admin"];

export default function DeliveryDetailPage() {
  const roles = getSessionRoles();
  const canResend = hasAnyRole(roles, NOTIFICATION_SEND_ROLES);
  const canSeeTechnicalDetail = hasAnyRole(roles, ADMIN_ROLES);
  return <DeliveryDetail canResend={canResend} canSeeTechnicalDetail={canSeeTechnicalDetail} />;
}
