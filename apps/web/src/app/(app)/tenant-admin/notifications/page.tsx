import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getNotificationPreferences } from "../../../_data/loaders";

export default async function NotificationPrefsPage() {
  const { data: prefs, source } = await getNotificationPreferences();

  const total = prefs.length;
  const emailEnabled = prefs.filter((p) => p.emailEnabled).length;
  const smsEnabled = prefs.filter((p) => p.smsEnabled).length;
  const inAppEnabled = prefs.filter((p) => p.inAppEnabled).length;

  const byModule = prefs.reduce<Record<string, typeof prefs>>((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  const modules = Object.keys(byModule);

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin"
        title="Notification Preferences"
        subtitle="Channel configuration for each event type across all modules."
        actions={
          <>
            <button className="btn ghost">Reset to defaults</button>
            <button className="btn primary">Save changes</button>
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
              <div className="empty-state"><div>🔔</div><h4>No notifications configured</h4><p>Event channel settings will appear here once modules are enabled.</p></div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Channel settings</h3></div>
          <div className="pad">
            {modules.length > 0 ? (
              modules.map((mod) => (
                <div key={mod}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "#667085", textTransform: "uppercase", letterSpacing: "0.05em", padding: "10px 0 6px" }}>
                    {mod.replace(/_/g, " ")}
                  </div>
                  {(byModule[mod] ?? []).map((pref) => (
                    <div key={pref.id} className="prefrow">
                      <span style={{ fontSize: 13 }}>{pref.label}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {pref.emailEnabled && <span className="pill info">Email</span>}
                        {pref.smsEnabled && <span className="pill info">SMS</span>}
                        {pref.inAppEnabled && <span className="pill info">In-app</span>}
                        {pref.webhookEnabled && <span className="pill info">Webhook</span>}
                        {!pref.emailEnabled && !pref.smsEnabled && !pref.inAppEnabled && !pref.webhookEnabled && (
                          <span className="pill mut">Off</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className="empty-state"><div>⚙️</div><h4>No channels</h4><p>Channel settings will appear here.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
