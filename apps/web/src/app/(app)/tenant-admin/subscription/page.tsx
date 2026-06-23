import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatusPill } from "../../../_components/ds";
import { getSubscription } from "../../../_data/loaders";

function formatCurrency(amount: number, currency: string): string {
  if (currency === "INR") return `₹${amount.toLocaleString("en-IN")}`;
  return `${currency} ${amount.toLocaleString()}`;
}

export default async function SubscriptionPage() {
  const { data: subscription, source } = await getSubscription();

  const usagePct = subscription && subscription.userLimit
    ? Math.min(100, Math.round((subscription.activeUsers / subscription.userLimit) * 100))
    : null;

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin"
        title="Subscription"
        subtitle="Billing plan, usage limits, and module access for this tenant."
        actions={
          <>
            <button className="btn ghost">Download invoice</button>
            <button className="btn primary">Upgrade plan</button>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      {subscription ? (
        <>
          <div className="grid g-4" style={{ marginBottom: 18 }}>
            <StatCard icon="📋" iconBg="#f1f5f9" label="Plan" value={subscription.plan} />
            <StatCard icon="👥" iconBg="#eff6ff" label="Active Users" value={subscription.activeUsers} />
            <StatCard icon="🎯" iconBg="#fffaeb" label="User Limit" value={subscription.userLimit != null ? subscription.userLimit : "∞"} />
            <StatCard icon="💳" iconBg="#ecfdf3" label="Amount" value={subscription.amount != null ? formatCurrency(subscription.amount, subscription.currency) : "—"} />
          </div>
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="card">
              <div className="card-h">
                <h3>Usage & quota</h3>
                <StatusPill status={subscription.status} label={subscription.status.replace(/_/g, " ")} />
              </div>
              <div className="pad">
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <span>Users</span>
                    <span>{subscription.activeUsers} / {subscription.userLimit ?? "∞"}</span>
                  </div>
                  {usagePct !== null && (
                    <div className="bar">
                      <i style={{ width: `${usagePct}%`, background: usagePct >= 90 ? "#ef4444" : usagePct >= 70 ? "#f59e0b" : "#22c55e" }} />
                    </div>
                  )}
                </div>
                <div className="fields">
                  <div className="fld"><div className="l">Period</div><div className="v">{subscription.currentPeriodStart.slice(0, 10)} – {subscription.currentPeriodEnd.slice(0, 10)}</div></div>
                  {subscription.billingEmail && <div className="fld"><div className="l">Billing email</div><div className="v">{subscription.billingEmail}</div></div>}
                  <div className="fld"><div className="l">Currency</div><div className="v">{subscription.currency}</div></div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-h"><h3>Module access</h3><span className="pill info">{subscription.moduleAccess.length} modules</span></div>
              <div className="pad">
                {subscription.moduleAccess.length > 0 ? (
                  subscription.moduleAccess.map((mod: string) => (
                    <div key={mod} className="prefrow">
                      <span>{mod}</span>
                      <span className="pill good">Included</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state"><div>🧩</div><h4>No modules listed</h4><p>Module access will appear here.</p></div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <div className="empty-state"><div>📋</div><h4>No subscription data</h4><p>Subscription information is unavailable.</p></div>
        </div>
      )}
    </div>
  );
}
