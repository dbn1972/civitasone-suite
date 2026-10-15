import { PageHeader, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { ChannelForm } from "./ChannelForm";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ChannelsTable, type Channel } from "./ChannelsTable";

// The notification-service channel model is { id, type, name, isDefault,
// enabled, version } — there is no provider/config/status field (see
// services/notification-service/src/modules/channels/domain.ts). The web type
// mirrors that exactly; delivery health is the boolean `enabled`.
async function getChannels(): Promise<LoaderResult<Channel[]>> {
  return fetchJson<unknown, Channel[]>("/api/notification/channels", [], {
    telemetryKey: "notifications.channels",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Channel[] })?.data;
      return Array.isArray(arr) ? arr as Channel[] : null;
    },
  });
}

export default async function NotificationChannelsPage() {
  const result = await getChannels();
  const { data: channels } = result;
  const errored = toResourceState(result).status === "error";

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Notification Channels"
        subtitle="Add the email, SMS or push channels your approvals and alerts are delivered through."
        back="/tenant-admin"
        backLabel="Office Admin"
      />

      <Card title="Configured Channels">
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "notification channels" })} backHref="/tenant-admin" />
        ) : channels.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="No notification channels configured"
            message="Add an email or SMS channel below so notifications can be delivered. Without this, approval reminders and alerts won't reach anyone."
          />
        ) : (
          <ChannelsTable channels={channels} canManage={getSessionRoles().some((r) => r === "tenant_admin" || r === "platform_admin" || r === "super_admin")} />
        )}
      </Card>

      {/* GAP-CHANNELS-01: a real Add form (POST /notifications/channels) replaces
          the raw API snippet, and rows can be enabled / disabled (audited PATCH).
          Edit and test-send are intentionally NOT shown — the notification-service
          has no such endpoint, so dead buttons would be worse than their absence
          (fix step 5). Test-send needs an owner decision (no provider send path). */}
      <ChannelForm />
    </div>
  );
}
