import { StatCard, StatGrid } from "../../_components/ds";
import { ModuleHub, type ModuleHubLink } from "../../_components/ModuleHub";
import { getNotificationDeliveries, getNotificationExperiments } from "../../_data/loaders";
import { getSessionRoles, hasAnyRole, NOTIFICATION_SEND_ROLES } from "@/lib/auth/roleGuard";
import { needsApproval } from "./experiments/experiments";

export const dynamic = "force-dynamic";

/**
 * Notifications hub. GAP-NOTIFICATIONS-HOME-01: the hub now carries signal — a
 * failed-delivery count and an awaiting-approval count — so a clerk can see
 * work needing attention without opening every page, and the tiles are ordered
 * for everyday use (Inbox first, niche Experiments last). Each count renders
 * "—" on a failed fetch, never a fabricated zero. GAP-NOTIFICATIONS-HOME-04:
 * the channel/provider Settings tile is shown only to notification admins so a
 * plain clerk is not sent to a page they cannot use.
 */
export default async function Page() {
  const roles = getSessionRoles();
  const isAdmin = hasAnyRole(roles, NOTIFICATION_SEND_ROLES);

  const [deliveries, experiments] = await Promise.all([
    getNotificationDeliveries(),
    getNotificationExperiments(),
  ]);

  // Honest counts, derived from the same lists the dedicated pages render; "—"
  // on error. The deliveries list is page-bounded, so the tile is labelled
  // "recent" rather than claiming an all-time total.
  const failedValue =
    deliveries.source === "error"
      ? "—"
      : deliveries.data
          .filter((d) => d.status === "failed" || d.status === "bounced")
          .length.toLocaleString("en-IN");
  const awaitingValue =
    experiments.source === "error"
      ? "—"
      : experiments.data.filter((e) => needsApproval(e.status)).length.toLocaleString("en-IN");

  const links: ModuleHubLink[] = [
    { href: "/notifications/list", label: "Inbox", note: "All notification events" },
    { href: "/notifications/compose", label: "Send", note: "Send a notification from a template" },
    { href: "/notifications/deliveries", label: "Deliveries", note: "Delivery status and failure log" },
    { href: "/notifications/templates", label: "Templates", note: "Message templates and versions" },
    { href: "/notifications/campaigns", label: "Campaigns", note: "Marketing campaign lifecycle, budget and ROI" },
    { href: "/notifications/experiments", label: "A/B Experiments", note: "MVT tests with approval-gated winner promotion" },
    // GAP-NOTIFICATIONS-HOME-04: channel/provider configuration, admin-only.
    ...(isAdmin
      ? [{ href: "/tenant-admin/notifications", label: "Settings", note: "Channels and provider configuration" }]
      : []),
  ];

  return (
    <ModuleHub
      title="Notifications"
      description="Notification inbox, delivery tracking, templates and sending."
      links={links}
    >
      <StatGrid>
        <StatCard
          icon="⚠️"
          tone="bad"
          href="/notifications/deliveries"
          label="Failed in recent deliveries"
          hint="Deliveries that failed or bounced in the most recent delivery log page."
          value={failedValue}
        />
        <StatCard
          icon="🛂"
          tone="warn"
          href="/notifications/experiments"
          label="Experiments awaiting approval"
          hint="A/B experiments where a winner was requested and is waiting on approval."
          value={awaitingValue}
        />
      </StatGrid>
    </ModuleHub>
  );
}
