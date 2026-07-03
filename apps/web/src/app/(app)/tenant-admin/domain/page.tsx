"use client";

import { useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";

interface CustomDomain {
  id: string;
  domain: string;
  status: "pending_verification" | "verified" | "active" | "failed" | "revoked";
  verificationMethod: "dns_txt" | "dns_cname";
  verificationToken: string;
  sslStatus: "pending" | "issued" | "expired";
  sslExpiresAt: string | null;
  createdAt: string;
}

interface WhiteLabelSettings {
  customEmailFrom: string;
  poweredByHidden: boolean;
  customLoginHtml: string;
}

function getDomainStatusBadge(status: string) {
  switch (status) {
    case "pending_verification": return <span className="badge badge-amber">Pending Verification</span>;
    case "verified": return <span className="badge badge-green">Verified</span>;
    case "active": return <span className="badge badge-green">✓ Active</span>;
    case "failed": return <span className="badge badge-red">Failed</span>;
    case "revoked": return <span className="badge badge-grey">Revoked</span>;
    default: return <span className="badge badge-grey">{status}</span>;
  }
}

function getSslBadge(status: string) {
  switch (status) {
    case "issued": return <span className="badge badge-green">SSL Active</span>;
    case "pending": return <span className="badge badge-blue">SSL Pending</span>;
    case "expired": return <span className="badge badge-red">SSL Expired</span>;
    default: return <span className="badge badge-grey">{status}</span>;
  }
}

const INITIAL_DOMAINS: CustomDomain[] = [
  {
    id: "1", domain: "erp.rajasthan.gov.in", status: "active",
    verificationMethod: "dns_txt", verificationToken: "civitasone-verify-a1b2c3d4e5f6",
    sslStatus: "issued", sslExpiresAt: "2025-06-15T00:00:00Z", createdAt: "2024-01-10T10:00:00Z",
  },
  {
    id: "2", domain: "finance.mypsu.co.in", status: "pending_verification",
    verificationMethod: "dns_cname", verificationToken: "civitasone-verify-x7y8z9w0",
    sslStatus: "pending", sslExpiresAt: null, createdAt: "2024-01-14T14:00:00Z",
  },
];

export default function DomainPage() {
  const [domains, setDomains] = useState<CustomDomain[]>(INITIAL_DOMAINS);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showInstructions, setShowInstructions] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [verificationMethod, setVerificationMethod] = useState<"dns_txt" | "dns_cname">("dns_txt");
  const [whiteLabelSettings, setWhiteLabelSettings] = useState<WhiteLabelSettings>({
    customEmailFrom: "",
    poweredByHidden: false,
    customLoginHtml: "",
  });

  const activeDomains = domains.filter((d) => d.status === "active").length;
  const pendingDomains = domains.filter((d) => d.status === "pending_verification").length;

  function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    const id = crypto.randomUUID();
    const token = `civitasone-verify-${id.replace(/-/g, "").slice(0, 12)}`;
    setDomains([...domains, {
      id, domain: newDomain, status: "pending_verification",
      verificationMethod, verificationToken: token,
      sslStatus: "pending", sslExpiresAt: null, createdAt: new Date().toISOString(),
    }]);
    setNewDomain("");
    setShowAddModal(false);
  }

  function handleVerify(id: string) {
    setDomains((prev) => prev.map((d) => d.id === id ? { ...d, status: "verified" as const } : d));
  }

  function handleDelete(id: string) {
    setDomains((prev) => prev.filter((d) => d.id !== id));
  }

  const instructionDomain = domains.find((d) => d.id === showInstructions);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Custom Domain & White-Label" subtitle="Configure custom domains and branding for your organization." back="/tenant-admin" />
      <StatGrid>
        <StatCard icon="🌐" iconBg="#eef2ff" label="Total Domains" value={domains.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activeDomains} />
        <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pendingDomains} />
        <StatCard icon="🔒" iconBg="#dbeafe" label="SSL Issued" value={domains.filter((d) => d.sslStatus === "issued").length} />
      </StatGrid>

      {/* Domains Section */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Custom Domains</h3>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add Domain</button>
        </div>
        <table className="data-table" role="table" aria-label="Custom domains list">
          <thead>
            <tr><th>Domain</th><th>Status</th><th>SSL</th><th>Added</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {domains.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: 32, color: "#888" }}>No custom domains configured.</td></tr>
            ) : (
              domains.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.domain}</strong></td>
                  <td>{getDomainStatusBadge(d.status)}</td>
                  <td>
                    {getSslBadge(d.sslStatus)}
                    {d.sslExpiresAt && <br />}
                    {d.sslExpiresAt && <small style={{ color: "#666" }}>Expires: {new Date(d.sslExpiresAt).toLocaleDateString("en-IN")}</small>}
                  </td>
                  <td>{new Date(d.createdAt).toLocaleDateString("en-IN")}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {d.status === "pending_verification" && (
                        <button className="btn btn-sm" onClick={() => handleVerify(d.id)} style={{ fontSize: 12 }}>✓ Verify</button>
                      )}
                      <button className="btn btn-sm" onClick={() => setShowInstructions(d.id)} style={{ fontSize: 12 }}>📋 DNS</button>
                      <button className="btn btn-sm" onClick={() => handleDelete(d.id)} style={{ fontSize: 12, color: "#dc2626" }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* White-Label Settings */}
      <div className="card" style={{ marginTop: 18 }}>
        <h3>White-Label Settings</h3>
        <p style={{ color: "#666", marginBottom: 16 }}>Customize the branding and appearance for your organization.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#f9fafb", borderRadius: 6 }}>
            <div>
              <strong>Hide &quot;Powered by CivitasOne&quot;</strong>
              <p style={{ color: "#666", fontSize: 13, margin: 0 }}>Enterprise only — removes branding from footer</p>
            </div>
            <label className="toggle" aria-label="Hide Powered By CivitasOne">
              <input type="checkbox" checked={whiteLabelSettings.poweredByHidden} onChange={(e) => setWhiteLabelSettings((s) => ({ ...s, poweredByHidden: e.target.checked }))} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div>
            <label htmlFor="custom-email" style={{ fontWeight: 600 }}>Custom Notification Email Address</label>
            <input
              id="custom-email" type="email" className="input" style={{ marginTop: 4 }}
              placeholder="noreply@yourdomain.gov.in"
              value={whiteLabelSettings.customEmailFrom}
              onChange={(e) => setWhiteLabelSettings((s) => ({ ...s, customEmailFrom: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="custom-login-html" style={{ fontWeight: 600 }}>Custom Login Page HTML</label>
            <textarea
              id="custom-login-html" className="input" style={{ marginTop: 4, fontFamily: "monospace", minHeight: 120 }}
              placeholder="<div class='login-banner'>Welcome to Department ERP</div>"
              value={whiteLabelSettings.customLoginHtml}
              onChange={(e) => setWhiteLabelSettings((s) => ({ ...s, customLoginHtml: e.target.value }))}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary">Save White-Label Settings</button>
          </div>
        </div>
      </div>

      {/* Add Domain Modal */}
      {showAddModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Add Custom Domain">
          <div className="modal-content" style={{ maxWidth: 450, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>Register Custom Domain</h3>
            <form onSubmit={handleAddDomain}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="domain-name">Domain Name</label>
                <input id="domain-name" type="text" className="input" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="erp.yourorg.gov.in" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="verify-method">Verification Method</label>
                <select id="verify-method" className="input" value={verificationMethod} onChange={(e) => setVerificationMethod(e.target.value as "dns_txt" | "dns_cname")}>
                  <option value="dns_txt">DNS TXT Record</option>
                  <option value="dns_cname">DNS CNAME Record</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Register</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DNS Instructions Modal */}
      {showInstructions && instructionDomain && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="DNS Instructions">
          <div className="modal-content" style={{ maxWidth: 520, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>DNS Verification Instructions</h3>
            <p style={{ color: "#666", margin: "8px 0 16px" }}>Add the following record to your DNS configuration:</p>
            <div style={{ background: "#f1f5f9", padding: 16, borderRadius: 6, fontFamily: "monospace", fontSize: 13 }}>
              {instructionDomain.verificationMethod === "dns_txt" ? (
                <>
                  <div><strong>Type:</strong> TXT</div>
                  <div><strong>Host:</strong> _civitasone-verification.{instructionDomain.domain}</div>
                  <div><strong>Value:</strong> {instructionDomain.verificationToken}</div>
                </>
              ) : (
                <>
                  <div><strong>Type:</strong> CNAME</div>
                  <div><strong>Host:</strong> _civitasone-verify.{instructionDomain.domain}</div>
                  <div><strong>Value:</strong> verify.civitasone.app</div>
                </>
              )}
            </div>
            <button
              className="btn btn-sm" style={{ marginTop: 12 }}
              onClick={() => navigator.clipboard.writeText(instructionDomain.verificationToken)}
              aria-label="Copy verification token"
            >
              📋 Copy Token
            </button>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn" onClick={() => setShowInstructions(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
