import { PageHeader, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

type Channel = {
  id: string;
  name: string;
  type: string;
  provider: string;
  config?: Record<string, unknown>;
  status: string;
} & Record<string, unknown>;

// UX-013: this used to return only `r.data`, discarding `r.source` — any
// fetch failure (network error, missing auth, non-2xx) collapsed to the
// same `[]` as a tenant with genuinely zero channels configured, so the
// page below could never tell the two apart. Return the full LoaderResult
// so the page can gate on `source` like every other fixed page.
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
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Notification Channels"
        subtitle="Configure email, SMS, and push providers so approvals and alerts reach your team."
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
            message="Add an email (SMTP/SES) or SMS provider so notifications can be delivered. Without this, approval reminders and alerts won't reach anyone."
          />
        ) : (
          <DataTable<Channel>
            columns={[
              { key: "name", label: "Channel Name" },
              { key: "type", label: "Type (email/sms/push)" },
              { key: "provider", label: "Provider" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={channels}
            sortable
          />
        )}
      </Card>

      <Card title="How to configure" padding>
        <div style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 10px" }}>Create a channel via the API:</p>
          <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 8, fontSize: 12, overflow: "auto" }}>
{`POST /api/notification/channels
{
  "name": "Office Email (SES)",
  "type": "email",
  "provider": "ses",
  "config": {
    "region": "ap-south-1",
    "fromAddress": "noreply@yourdomain.gov.in"
  }
}`}
          </pre>
          <p style={{ margin: "10px 0 0" }}>Supported providers: <strong>ses</strong> (AWS SES), <strong>smtp</strong> (any SMTP server), <strong>sns</strong> (AWS SNS for SMS), <strong>fcm</strong> (Firebase push).</p>
        </div>
      </Card>
    </div>
  );
}
