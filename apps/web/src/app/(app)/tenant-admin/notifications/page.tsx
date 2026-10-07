import { PageHeader, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getNotificationPreferences } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { NotificationPrefActions } from "./NotificationPrefActions";

export default async function NotificationPrefsPage() {
  const result = await getNotificationPreferences();
  const { data: prefs } = result;
  const errored = toResourceState(result).status === "error";

  const total = prefs.length;
  const emailEnabled = prefs.filter((p) => p.emailEnabled).length;
  const inAppEnabled = prefs.filter((p) => p.inAppEnabled).length;
  // GAP-TENANT-ADMIN-NOTIFICATIONS-03: "off" counts of the channels the admin
  // can actually change — replaces the misleading "SMS On" KPI (SMS is not
  // stored/configurable here).
  const emailOff = total - emailEnabled;
  const inAppOff = total - inAppEnabled;

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Notification Preferences" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Notification Preferences"
        subtitle="Tenant-wide default channels (Email and In-app) for each event type."
        actions={
          <>
            {/* GAP-TENANT-ADMIN-NOTIFICATIONS-03: deep-link the audit view to the
                notification-preference events only. */}
            <a className="btn ghost" href="/tenant-admin/audit?entity=notification-prefs" style={{ minHeight: 44 }}>Audit changes</a>
          </>
        }
      />

      {errored ? (
        // GAP-TENANT-ADMIN-NOTIFICATIONS-05: a failed load must not read as "all
        // channels are off / nothing configured" — show the error + retry and
        // "—" in the KPIs, and skip the editor entirely.
        <>
          <div className="grid g-4" style={{ marginBottom: 18 }}>
            <StatCard icon="🔔" iconBg="#f1f5f9" label="Event Types" value="—" />
            <StatCard icon="📧" iconBg="#eff6ff" label="Email On" value="—" />
            <StatCard icon="📧" iconBg="#fef2f2" label="Email Off" value="—" />
            <StatCard icon="🖥️" iconBg="#fffaeb" label="In-App On" value="—" />
          </div>
          <Card title="Notification preferences" padding>
            <RefreshErrorState error={toHumanError("load", { area: "notification preferences" })} backHref="/tenant-admin" />
          </Card>
        </>
      ) : (
        <>
          <div className="grid g-4" style={{ marginBottom: 18 }}>
            <StatCard icon="🔔" iconBg="#f1f5f9" label="Event Types" value={total} />
            <StatCard icon="📧" iconBg="#eff6ff" label="Email On" value={emailEnabled} />
            <StatCard icon="📧" iconBg="#fef2f2" label="Email Off" value={emailOff} />
            <StatCard icon="🖥️" iconBg="#fffaeb" label="In-App On" value={inAppEnabled} />
          </div>
          {/* GAP-TENANT-ADMIN-NOTIFICATIONS-04: the former left "Notification
              events" card listed every event a second time — the editor on the
              right already lists them grouped by module. Dropped so each event
              appears exactly once; the editor is now the single column. */}
          <div style={{ marginTop: 18 }}>
            <NotificationPrefActions prefs={prefs} />
          </div>
          <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 8 }}>
            In-app off across {inAppOff} event{inAppOff === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </div>
  );
}
