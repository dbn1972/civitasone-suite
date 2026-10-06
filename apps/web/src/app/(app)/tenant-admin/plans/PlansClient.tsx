"use client";

import { useState } from "react";
import { Button, EmptyState, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney } from "@/lib/formatters";
import { formatDateTimeIST } from "@/lib/formatters";
import type { PlansData } from "@/app/_data/loaders";

const ALL_MODULES = ["finance", "hrms", "payroll", "procurement", "contract", "asset", "helpdesk", "knowledge", "projects", "inventory", "grant", "citizen", "legal", "crm", "estab"];

export function PlansClient({ plansData, source }: { plansData: PlansData; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.plans", plansData, source, (d) => d.plans.length === 0);
  // GAP-TENANT-ADMIN-PLANS-03: single source of truth — the current plan is
  // derived from the loader data, never a locally-mutated copy that could
  // drift from the header StatCards after a (previously fake) change.
  const currentPlanId = data.currentPlanId;
  const [changeTarget, setChangeTarget] = useState<string | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);

  // GAP-TENANT-ADMIN-PLANS-05: sort by price so Upgrade/Downgrade is computed
  // from rank, not array order (an unsorted API response used to mislabel it).
  const plans = [...data.plans].sort((a, b) => a.pricePerMonth - b.pricePerMonth);
  const invoices = data.invoices;
  const trialDaysLeft = data.trialDaysLeft;
  const currentPlan = plans.find((p) => p.id === currentPlanId);
  const currentPrice = currentPlan?.pricePerMonth ?? -1;
  const targetPlan = plans.find((p) => p.id === changeTarget);
  const isUpgrade = targetPlan ? targetPlan.pricePerMonth > currentPrice : false;

  if (plans.length === 0) {
    return (
      <div className="card" style={{ marginTop: 18 }}>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        <EmptyState icon="📋" title="No plans available" message="Plans will appear here once configured by the platform admin." />
      </div>
    );
  }

  function getInvoiceStatusBadge(status: string) {
    switch (status) {
      case "paid": return <span className="pill good">Paid</span>;
      case "pending": return <span className="pill warn">Pending</span>;
      case "failed": return <span className="pill bad">Failed</span>;
      default: return <span className="pill mut">{status}</span>;
    }
  }

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {trialDaysLeft !== null && (
        <div style={{ background: "var(--warnbg)", border: "1px solid var(--warnbd)", borderRadius: 8, padding: "12px 16px", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }} role="alert">
          <span><span aria-hidden="true">⚠️ </span><strong>{trialDaysLeft} days left</strong> in your trial. Contact your administrator to choose a plan.</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 18 }}>
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const planIsUpgrade = plan.pricePerMonth > currentPrice;
          return (
            <div key={plan.id} className="card" style={{ border: isCurrent ? "2px solid var(--primary)" : "1px solid var(--line)", position: "relative" }}>
              {isCurrent && (
                <span style={{ position: "absolute", top: -10, left: 16, background: "var(--primary)", color: "var(--on-primary, #fff)", padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Current Plan</span>
              )}
              <h3 style={{ marginTop: isCurrent ? 8 : 0 }}>{plan.name}</h3>
              <p style={{ fontSize: 28, fontWeight: 700, margin: "8px 0" }}>{formatMoney(plan.pricePerMonth)}<small style={{ fontSize: 14, fontWeight: 400, color: "var(--mut)" }}>/month</small></p>
              <ul style={{ listStyle: "none", padding: 0, margin: "12px 0" }}>
                <li style={{ padding: "4px 0" }}>Up to <strong>{plan.maxUsers.toLocaleString("en-IN")}</strong> users</li>
                <li style={{ padding: "4px 0" }}><strong>{plan.storageGb} GB</strong> storage</li>
                <li style={{ padding: "4px 0" }}><strong>{plan.maxApiCalls.toLocaleString("en-IN")}</strong> API calls/month</li>
              </ul>
              <h4 style={{ marginTop: 12, marginBottom: 8 }}>Modules</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {ALL_MODULES.map((mod) => (
                  <div key={mod} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <StatusPill status={plan.modules.includes(mod) ? "active" : "inactive"} label={plan.modules.includes(mod) ? "Included" : "Not included"} />
                    <span>{mod}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                {isCurrent ? (
                  <Button variant="ghost" disabled style={{ width: "100%" }}>Current Plan</Button>
                ) : (
                  <Button variant={planIsUpgrade ? "primary" : "ghost"} style={{ width: "100%" }} onClick={() => setChangeTarget(plan.id)}>
                    {planIsUpgrade ? "Request upgrade" : "Request downgrade"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Invoice History</h3>
          <Button size="sm" onClick={() => setShowInvoices(!showInvoices)}>{showInvoices ? "Hide" : "Show"}</Button>
        </div>
        {showInvoices && (
          invoices.length === 0 ? (
            <EmptyState icon="🧾" title="No invoices yet" message="Invoice history will appear here after your first billing cycle." />
          ) : (
            <table className="data-table" role="table" aria-label="Invoice history">
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{formatDateTimeIST(inv.date)}</td>
                    <td>{formatMoney(inv.amount)}</td>
                    <td>{getInvoiceStatusBadge(inv.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
        {/* GAP-TENANT-ADMIN-PLANS-04: the "📥 PDF" button had no handler and no
            invoice-download endpoint exists, so it is removed rather than left
            as a dead control. GST invoice columns will be added once the billing
            API exposes invoice number/GSTIN/tax split. */}
      </div>

      {/* GAP-TENANT-ADMIN-PLANS-01/-02/-05: no fake "payment"/"success". Plan
          changes are handled by the platform administrator (self-serve billing
          is super-admin-only in billing-service), so confirming records intent
          and tells the truth — it never shows success without a real 2xx. */}
      <ConfirmDialog
        open={changeTarget !== null && targetPlan !== undefined && currentPlan !== undefined}
        title={isUpgrade ? `Request upgrade to ${targetPlan?.name ?? ""}` : `Request downgrade to ${targetPlan?.name ?? ""}`}
        danger={!isUpgrade}
        description={
          targetPlan && currentPlan ? (
            <div>
              <p style={{ margin: "0 0 10px" }}>
                {isUpgrade ? "You are requesting an upgrade." : "You are requesting a downgrade."} Changes to {currentPlan.name} → {targetPlan.name}:
              </p>
              <ul style={{ paddingLeft: 20, margin: "0 0 10px" }}>
                <li>Users: {currentPlan.maxUsers.toLocaleString("en-IN")} → {targetPlan.maxUsers.toLocaleString("en-IN")}</li>
                <li>Storage: {currentPlan.storageGb} GB → {targetPlan.storageGb} GB</li>
                <li>Price: {formatMoney(currentPlan.pricePerMonth)} → {formatMoney(targetPlan.pricePerMonth)}/month</li>
              </ul>
              {!isUpgrade && currentPlan.modules.filter((m) => !targetPlan.modules.includes(m)).length > 0 && (
                <div style={{ background: "var(--warnbg)", border: "1px solid var(--warnbd)", borderRadius: 6, padding: 10, margin: "0 0 10px" }}>
                  <strong>These modules will be disabled:</strong>
                  <ul style={{ paddingLeft: 20, margin: "4px 0 0" }}>
                    {currentPlan.modules.filter((m) => !targetPlan.modules.includes(m)).map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
                Plan changes are applied by your platform administrator. Nothing is recorded or changed here — contact your platform administrator to request this plan change. You will not be charged here.
              </p>
            </div>
          ) : null
        }
        confirmLabel="Contact administrator"
        onConfirm={() => setChangeTarget(null)}
        onCancel={() => setChangeTarget(null)}
      />
    </>
  );
}
