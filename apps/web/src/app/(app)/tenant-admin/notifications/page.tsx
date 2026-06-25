import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, EmptyState } from "../../../_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getNotificationPreferences } from "../../../_data/loaders";
import { NotificationPrefActions } from "./NotificationPrefActions";

export default async function NotificationPrefsPage() {
  const { data: prefs, source } = await getNotificationPreferences();

  const total = prefs.length;
  const emailEnabled = prefs.filter((p) => p.emailEnabled).length;
  const smsEnabled = prefs.filter((p) => p.smsEnabled).length;
  const inAppEnabled = prefs.filter((p) => p.inAppEnabled).length;

  return (
    <div className="wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Notification Preferences" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Notification Preferences"
        subtitle="Channel configuration for each event type across all modules."
        actions={
          <>
            <a className="btn ghost" href="/tenant-admin/audit">Audit changes</a>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔔" iconBg="#f1f5f9" label="Event Types" value={total} />
        <StatCard icon="📧" iconBg="#eff6ff" label="Email On" value={emailEnabled} />
        <StatCard icon="📱" iconBg="#ecfdf3" label="SMS On" value={smsEnabled} />
        <StatCard icon="🖥️" iconBg="#fffaeb" label="In-App On" value={inAppEnabled} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-h"><h3>Notification events</h3></div>
          <div className="pad">
            {prefs.length > 0 ? (
              prefs.map((pref) => (
                <div key={pref.id} className={`ntf${pref.inAppEnabled ? " unread" : ""}`}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{pref.label}</div>
                  <div style={{ fontSize: 12, color: "#98a2b3" }}><span className="mono">{pref.module}</span> · {pref.eventType}</div>
                </div>
              ))
            ) : (
              <EmptyState icon="🔔" title="No notifications configured" message="Event channel settings will appear here once modules are enabled." />
            )}
          </div>
        </div>
        <NotificationPrefActions prefs={prefs} />
      </div>
    </div>
  );
}
