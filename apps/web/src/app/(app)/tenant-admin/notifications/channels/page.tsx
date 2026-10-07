import { PageHeader, Card, DataTable, StatusPill, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { ChannelForm } from "./ChannelForm";

// The notification-service channel model is { id, type, name, isDefault,
// enabled, version } — there is no provider/config/status field (see
// services/notification-service/src/modules/channels/domain.ts). The web type
// mirrors that exactly; delivery health is the boolean `enabled`.
type Channel = {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  enabled: boolean;
} & Record<string, unknown>;

const TYPE_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push notification",
  in_app: "In-app",
  whatsapp: "WhatsApp",
};

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
          <DataTable<Channel>
            columns={[
              { key: "name", label: "Channel name" },
              // GAP-CHANNELS-02: no developer hint in the header; values via a label map.
              { key: "type", label: "Channel type", render: (c) => TYPE_LABELS[c.type] ?? c.type },
              { key: "isDefault", label: "Default", render: (c) => (c.isDefault ? "Default" : "—") },
              // GAP-CHANNELS-05: delivery health is the boolean `enabled`, not a status enum.
              { key: "enabled", label: "Status", render: (c) => <StatusPill status={c.enabled ? "active" : "disabled"} label={c.enabled ? "Enabled" : "Disabled"} variant={c.enabled ? "good" : "mut"} /> },
            ]}
            rows={channels}
            sortable
          />
        )}
      </Card>

      {/* GAP-CHANNELS-01: a real Add form (POST /notifications/channels) replaces
          the raw API snippet. Edit / test-send / disable are intentionally NOT
          shown — the notification-service exposes only create + list, so dead
          buttons would be worse than their absence (fix step 5). */}
      <ChannelForm />
    </div>
  );
}
