import { PageHeader, StatCard, StatusPill, EmptyState, Card, RefreshErrorState } from "../../../_components/ds";
import { formatIndianDate, formatMoney, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { getSubscription } from "../../../_data/loaders";
import { PLANS_HREF } from "../navConstants";

const STATUS_KEYS = new Set(["active", "past_due", "cancelled", "trial", "suspended"]);

/** Human display name for a raw module key (fallback: humanized key). */
function moduleDisplayName(key: string): string {
  return humanizeStatus(key);
}

export default async function SubscriptionPage() {
  const tStatus = await getTranslations("tenantAdminW2.subscription.status");
  const result = await getSubscription();
  const { data: subscription } = result;
  // null-on-api (genuinely no subscription) is distinct from source:"error".
  const errored = result.source === "error";

  const usagePct = subscription && subscription.userLimit
    ? Math.min(100, Math.round((subscription.activeUsers / subscription.userLimit) * 100))
    : null;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Subscription"
        subtitle="Billing plan, usage limits, and module access for this tenant."
        actions={
          // GAP-TENANT-ADMIN-SUBSCRIPTION-01: no live header actions on an
          // outage — they would act on data we failed to load.
          errored ? undefined : (
            <>
              {/* GAP-TENANT-ADMIN-SUBSCRIPTION-04 (INTERIM, needs owner decision): the
                  "Download invoice" link pointed at /v1/billing/invoices/latest?format=pdf,
                  which no service implements (billing-service has GET
                  /v1/billing/invoices/:id with a uuid id and no PDF renderer), so it was a
                  dead control that always failed. Removed rather than left misleading; an
                  invoice list + PDF download needs a billing-service invoice-PDF endpoint. */}
              {/* GAP-TENANT-ADMIN-SUBSCRIPTION-02: tenant upgrade -> tenant-admin plans. */}
              <a href={PLANS_HREF} className="btn primary" style={{ minHeight: 44 }}>Upgrade plan</a>
            </>
          )
        }
      />
      {errored ? (
        <Card title="Subscription">
          <RefreshErrorState error={toHumanError("load", { area: "subscription" })} backHref="/tenant-admin" />
        </Card>
      ) : subscription ? (
        <>
          <div className="grid g-4" style={{ marginBottom: 18 }}>
            <StatCard icon="📋" iconBg="#f1f5f9" label="Plan" value={subscription.plan} />
            <StatCard icon="👥" iconBg="#eff6ff" label="Active Users" value={subscription.activeUsers} />
            <StatCard icon="🎯" iconBg="#fffaeb" label="User Limit" value={subscription.userLimit != null ? subscription.userLimit : "∞"} />
            {/* GAP-TENANT-ADMIN-SUBSCRIPTION-03/05: amount is money in MINOR
                units (paise) per the platform money rule — format via
                formatMoney (never ₹ + toLocaleString on a raw number). */}
            <StatCard icon="💳" iconBg="#ecfdf3" label="Amount" value={subscription.amount != null ? formatMoney(subscription.amount) : "—"} />
          </div>
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="card">
              <div className="card-h">
                <h3>Usage & quota</h3>
                {/* GAP-TENANT-ADMIN-SUBSCRIPTION-05: let StatusPill humanize
                    ('Past Due') instead of a raw lowercased string. */}
                <StatusPill status={subscription.status} label={STATUS_KEYS.has(subscription.status) ? tStatus(subscription.status) : undefined} />
              </div>
              <div className="pad">
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <span>Users</span>
                    <span>{subscription.activeUsers} / {subscription.userLimit ?? "∞"}</span>
                  </div>
                  {usagePct !== null && (
                    <div
                      className="bar"
                      role="progressbar"
                      aria-valuenow={usagePct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Users usage ${usagePct}%`}
                    >
                      <i style={{ width: `${usagePct}%`, background: usagePct >= 90 ? "#ef4444" : usagePct >= 70 ? "#f59e0b" : "#22c55e" }} />
                    </div>
                  )}
                  {usagePct !== null && (
                    <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }}>{usagePct}% of user limit</div>
                  )}
                </div>
                <div className="fields">
                  <div className="fld"><div className="l">Period</div><div className="v">{formatIndianDate(subscription.currentPeriodStart)} – {formatIndianDate(subscription.currentPeriodEnd)}</div></div>
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
                      <span>{moduleDisplayName(mod)}</span>
                      <span className="pill good">Included</span>
                    </div>
                  ))
                ) : (
                  <EmptyState icon="🧩" title="No modules listed" message="Module access will appear here." />
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <EmptyState icon="📋" title="No active subscription" message="This tenant has no active subscription." action={<a href={PLANS_HREF} className="btn primary">View plans</a>} />
        </div>
      )}
    </div>
  );
}
