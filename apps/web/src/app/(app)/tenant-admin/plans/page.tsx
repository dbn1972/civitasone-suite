"use client";

import { useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";

interface Plan {
  id: string;
  name: string;
  pricePerMonth: number;
  maxUsers: number;
  storageGb: number;
  maxApiCalls: number;
  modules: string[];
}

interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: "paid" | "pending" | "failed";
}

const PLANS: Plan[] = [
  {
    id: "plan-small-office", name: "Small Office", pricePerMonth: 9999,
    maxUsers: 100, storageGb: 50, maxApiCalls: 10000,
    modules: ["finance", "hrms", "payroll", "helpdesk", "knowledge"],
  },
  {
    id: "plan-psu", name: "PSU", pricePerMonth: 49999,
    maxUsers: 2000, storageGb: 500, maxApiCalls: 100000,
    modules: ["finance", "hrms", "payroll", "procurement", "contract", "asset", "helpdesk", "knowledge", "projects", "inventory"],
  },
  {
    id: "plan-govt", name: "Govt Department", pricePerMonth: 99999,
    maxUsers: 10000, storageGb: 2000, maxApiCalls: 500000,
    modules: ["finance", "hrms", "payroll", "procurement", "contract", "asset", "helpdesk", "knowledge", "projects", "inventory", "grant", "citizen", "legal", "crm", "estab"],
  },
];

const ALL_MODULES = ["finance", "hrms", "payroll", "procurement", "contract", "asset", "helpdesk", "knowledge", "projects", "inventory", "grant", "citizen", "legal", "crm", "estab"];

const INVOICES: Invoice[] = [
  { id: "inv-1", date: "2024-01-01", amount: 9999, status: "paid" },
  { id: "inv-2", date: "2023-12-01", amount: 9999, status: "paid" },
  { id: "inv-3", date: "2023-11-01", amount: 9999, status: "paid" },
  { id: "inv-4", date: "2023-10-01", amount: 9999, status: "paid" },
];

function formatCurrency(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default function PlansPage() {
  const [currentPlanId, setCurrentPlanId] = useState("plan-small-office");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showDowngradeModal, setShowDowngradeModal] = useState(false);
  const [targetPlanId, setTargetPlanId] = useState<string | null>(null);
  const [upgradeStep, setUpgradeStep] = useState(0);
  const [trialDaysLeft] = useState<number | null>(3);
  const [showInvoices, setShowInvoices] = useState(false);

  const currentPlan = PLANS.find((p) => p.id === currentPlanId)!;
  const targetPlan = PLANS.find((p) => p.id === targetPlanId);

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
    // Simulate Razorpay payment
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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Plans & Subscription" subtitle="Compare plans, upgrade, or manage your subscription." back="/tenant-admin" />

      {/* Trial Banner */}
      {trialDaysLeft !== null && (
        <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "12px 16px", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }} role="alert">
          <span>⚠️ <strong>{trialDaysLeft} days left</strong> in your trial. Upgrade now to keep access.</span>
          <button className="btn btn-primary btn-sm" onClick={() => handleUpgrade("plan-psu")}>Upgrade Now</button>
        </div>
      )}

      <StatGrid>
        <StatCard icon="📋" iconBg="#eef2ff" label="Current Plan" value={currentPlan.name} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Max Users" value={currentPlan.maxUsers.toLocaleString()} />
        <StatCard icon="💾" iconBg="#dbeafe" label="Storage" value={`${currentPlan.storageGb} GB`} />
        <StatCard icon="💰" iconBg="#fef3c7" label="Monthly Cost" value={formatCurrency(currentPlan.pricePerMonth)} />
      </StatGrid>

      {/* Plan Comparison Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 18 }}>
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const isUpgrade = PLANS.indexOf(plan) > PLANS.findIndex((p) => p.id === currentPlanId);
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

      {/* Invoice History */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Invoice History</h3>
          <button className="btn btn-sm" onClick={() => setShowInvoices(!showInvoices)}>{showInvoices ? "Hide" : "Show"}</button>
        </div>
        {showInvoices && (
          <table className="data-table" role="table" aria-label="Invoice history">
            <thead>
              <tr><th>Date</th><th>Amount</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {INVOICES.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "#888" }}>No invoices yet.</td></tr>
              ) : (
                INVOICES.map((inv) => (
                  <tr key={inv.id}>
                    <td>{new Date(inv.date).toLocaleDateString("en-IN")}</td>
                    <td>{formatCurrency(inv.amount)}</td>
                    <td>{getInvoiceStatusBadge(inv.status)}</td>
                    <td><button className="btn btn-sm" style={{ fontSize: 11 }}>📥 PDF</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Upgrade Modal */}
      {showUpgradeModal && targetPlan && (
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
                <div style={{ fontSize: 48, animation: "pulse 1s infinite" }}>💳</div>
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

      {/* Downgrade Modal */}
      {showDowngradeModal && targetPlan && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Downgrade Plan">
          <div className="modal-content" style={{ maxWidth: 480, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3 style={{ color: "#dc2626" }}>⚠️ Downgrade to {targetPlan.name}</h3>
            {currentPlan.maxUsers > targetPlan.maxUsers && (
              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 12, margin: "12px 0" }}>
                <strong>Warning:</strong> You currently have access to {currentPlan.maxUsers} users. Downgrading limits you to {targetPlan.maxUsers}. Please remove users first if over the limit.
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
    </main>
  );
}
