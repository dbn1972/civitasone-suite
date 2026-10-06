import { PageHeader } from "../../../../_components/ds";
import { getSessionRoles, hasAnyRole, NOTIFICATION_SEND_ROLES } from "@/lib/auth/roleGuard";
import { CampaignDetail } from "../_components/CampaignDetail";

/** MK-001 / MK-004 — a single campaign: fields, metrics dashboard, send/cancel. */
export default function Page({ params }: { params: { id: string } }) {
  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01: campaign send/cancel is an admin-only
  // commercial mass-send. The notification-service already restricts it to
  // NOTIFICATION_SEND_ROLES (bulk/routes.ts requireRole(ADMIN)) and 403s others;
  // the UI must not offer the controls to a user who would only hit that 403.
  const canManage = hasAnyRole(getSessionRoles(), NOTIFICATION_SEND_ROLES);
  return (
    <>
      <PageHeader
        title="Campaign"
        subtitle="Campaign details, delivery metrics and ROI, with send and cancel actions."
        back="/notifications/campaigns"
        backLabel="Campaigns"
      />
      <CampaignDetail campaignId={params.id} canManage={canManage} />
    </>
  );
}
