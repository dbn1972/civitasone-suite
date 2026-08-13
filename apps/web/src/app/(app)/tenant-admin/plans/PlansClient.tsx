"use client";

import { useState } from "react";
import { EmptyState } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { PlansData } from "@/app/_data/loaders";

const ALL_MODULES = ["finance", "hrms", "payroll", "procurement", "contract", "asset", "helpdesk", "knowledge", "projects", "inventory", "grant", "citizen", "legal", "crm", "estab"];

function formatCurrency(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function PlansClient({ plansData, source }: { plansData: PlansData; source: "api" | "error" }) {
  const { data } = useSeededResource("admin.plans", plansData, source, (d) => d.plans.length === 0);
  const [currentPlanId, setCurrentPlanId] = useState(data.currentPlanId);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showDowngradeModal, setShowDowngradeModal] = useState(false);
  const [targetPlanId, setTargetPlanId] = useState<string | null>(null);
  const [upgradeStep, setUpgradeStep] = useState(0);
  const [showInvoices, setShowInvoices] = useState(false);

  const plans = data.plans;
  const invoices = data.invoices;
  const trialDaysLeft = data.trialDaysLeft;
  const currentPlan = plans.find((p) => p.id === currentPlanId);
  const targetPlan = plans.find((p) => p.id === targetPlanId);

  if (plans.length === 0) {
    return (
      <div className="card" style={{ marginTop: 18 }}>
        <EmptyState icon="📋" title="No plans available" message="Plans will appear here once configured by the platform admin." />
      </div>
    );
  }

  function handleUpgrade(planId: string) {
    setTargetPlanId(planId);
    setUpgradeStep(1);
    setShowUpgradeModal(true);
  }

  function handleDowngrade(planId: string) {
    setTargetPlanId(planId);
    setShowDowngradeModal(true);
  }

  function confirmUpgrade() {
    setUpgradeStep(2);
    setTimeout(() => {
      setUpgradeStep(3);
      setCurrentPlanId(targetPlanId!);
    }, 2000);
  }

  function getInvoiceStatusBadge(status: string) {
    switch (status) {
      case "paid": return <span className="badge badge-green">Paid</span>;
      case "pending": return <span className="badge badge-amber">Pending</span>;
      case "failed": return <span className="badge badge-red">Failed</span>;
      default: return <span className="badge badge-grey">{status}</span>;
    }
  }

  return (
    <>
      {trialDaysLeft !== null && (
        <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "12px 16px", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }} role="alert">
          <span>⚠️ <strong>{trialDaysLeft} days left</strong> in your trial. Upgrade now to keep access.</span>
          <button className="btn btn-primary btn-sm" onClick={() => handleUpgrade(plans[1]?.id ?? plans[0].id)}>Upgrade Now</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 18 }}>
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const isUpgrade = plans.indexOf(plan) > plans.findIndex((p) => p.id === currentPlanId);
          return (
            <div key={plan.id} className="card" style={{ border: isCurrent ? "2px solid #1e40af" : "1px solid #e5e7eb", position: "relative" }}>
              {isCurrent && (
                <span style={{ position: "absolute", top: -10, left: 16, background: "#1e40af", color: "#fff", padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Current Plan</span>
              )}
              <h3 style={{ marginTop: isCurrent ? 8 : 0 }}>{plan.name}</h3>
              <p style={{ fontSize: 28, fontWeight: 700, margin: "8px 0" }}>{formatCurrency(plan.pricePerMonth)}<small style={{ fontSize: 14, fontWeight: 400, color: "#666" }}>/month</small></p>
              <ul style={{ listStyle: "none", padding: 0, margin: "12px 0" }}>
                <li style={{ padding: "4px 0" }}>👥 Up to <strong>{plan.maxUsers.toLocaleString()}</strong> users</li>
                <li style={{ padding: "4px 0" }}>💾 <strong>{plan.storageGb} GB</strong> storage</li>
                <li style={{ padding: "4px 0" }}>🔗 <strong>{plan.maxApiCalls.toLocaleString()}</strong> API calls/month</li>
              </ul>
              <h4 style={{ marginTop: 12, marginBottom: 8 }}>Modules</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {ALL_MODULES.map((mod) => (
                  <div key={mod} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    {plan.modules.includes(mod) ? <span style={{ color: "#16a34a" }}>✅</span> : <span style={{ color: "#dc2626" }}>❌</span>}
                    <span>{mod}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                {isCurrent ? (
                  <button className="btn" disabled style={{ width: "100%", opacity: 0.5 }}>Current Plan</button>
                ) : isUpgrade ? (
                  <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => handleUpgrade(plan.id)}>⬆ Upgrade</button>
                ) : (
                  <button className="btn" style={{ width: "100%", color: "#dc2626" }} onClick={() => handleDowngrade(plan.id)}>⬇ Downgrade</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Invoice History</h3>
          <button className="btn btn-sm" onClick={() => setShowInvoices(!showInvoices)}>{showInvoices ? "Hide" : "Show"}</button>
        </div>
        {showInvoices && (
          invoices.length === 0 ? (
            <EmptyState icon="🧾" title="No invoices yet" message="Invoice history will appear here after your first billing cycle." />
          ) : (
            <table className="data-table" role="table" aria-label="Invoice history">
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Action</th></tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{new Date(inv.date).toLocaleDateString("en-IN")}</td>
                    <td>{formatCurrency(inv.amount)}</td>
                    <td>{getInvoiceStatusBadge(inv.status)}</td>
                    <td><button className="btn btn-sm" style={{ fontSize: 11 }}>📥 PDF</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {showUpgradeModal && targetPlan && currentPlan && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Upgrade Plan">
          <div className="modal-content" style={{ maxWidth: 480, padding: 24, borderRadius: 8, background: "#fff" }}>
            {upgradeStep === 1 && (
              <>
                <h3>Upgrade to {targetPlan.name}</h3>
                <p style={{ margin: "12px 0", color: "#444" }}>You&apos;re gaining:</p>
                <ul style={{ paddingLeft: 20 }}>
                  <li>Users: {currentPlan.maxUsers} → {targetPlan.maxUsers}</li>
                  <li>Storage: {currentPlan.storageGb}GB → {targetPlan.storageGb}GB</li>
                  {targetPlan.modules.filter((m) => !currentPlan.modules.includes(m)).map((m) => (
                    <li key={m}>+ {m} module</li>
                  ))}
                </ul>
                <p style={{ margin: "12px 0", fontWeight: 600 }}>New price: {formatCurrency(targetPlan.pricePerMonth)}/month</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                  <button className="btn" onClick={() => { setShowUpgradeModal(false); setUpgradeStep(0); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={confirmUpgrade}>Pay via Razorpay</button>
                </div>
              </>
            )}
            {upgradeStep === 2 && (
              <div style={{ textAlign: "center", padding: 32 }}>
                <div style={{ fontSize: 48 }}>💳</div>
                <p style={{ marginTop: 12 }}>Processing payment...</p>
              </div>
            )}
            {upgradeStep === 3 && (
              <div style={{ textAlign: "center", padding: 32 }}>
                <div style={{ fontSize: 48 }}>✅</div>
                <h3 style={{ marginTop: 12 }}>Upgrade Successful!</h3>
                <p style={{ color: "#666", margin: "8px 0" }}>Changes take effect immediately.</p>
                <button className="btn btn-primary" onClick={() => { setShowUpgradeModal(false); setUpgradeStep(0); }}>Done</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showDowngradeModal && targetPlan && currentPlan && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Downgrade Plan">
          <div className="modal-content" style={{ maxWidth: 480, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3 style={{ color: "#dc2626" }}>⚠️ Downgrade to {targetPlan.name}</h3>
            {currentPlan.maxUsers > targetPlan.maxUsers && (
              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 12, margin: "12px 0" }}>
                <strong>Warning:</strong> You currently have access to {currentPlan.maxUsers} users. Downgrading limits you to {targetPlan.maxUsers}.
              </div>
            )}
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 6, padding: 12, margin: "12px 0" }}>
              <strong>Data Preservation:</strong> Your data is preserved but the following modules will be disabled:
              <ul style={{ paddingLeft: 20, marginTop: 4 }}>
                {currentPlan.modules.filter((m) => !targetPlan.modules.includes(m)).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn" onClick={() => setShowDowngradeModal(false)}>Cancel</button>
              <button className="btn" style={{ background: "#dc2626", color: "#fff", border: "none" }} onClick={() => { setCurrentPlanId(targetPlanId!); setShowDowngradeModal(false); }}>Confirm Downgrade</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
