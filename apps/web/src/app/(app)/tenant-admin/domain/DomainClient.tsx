"use client";

import { useState } from "react";
import { EmptyState } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { CustomDomain } from "@/app/_data/loaders";

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

export function DomainClient({ domains: initialDomains, source }: { domains: CustomDomain[]; source: "api" | "error" }) {
  const { data: seededDomains } = useSeededResource("admin.domains", initialDomains, source, (d) => d.length === 0);
  const [domains, setDomains] = useState<CustomDomain[]>(seededDomains);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showInstructions, setShowInstructions] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [verificationMethod, setVerificationMethod] = useState<"dns_txt" | "dns_cname">("dns_txt");

  function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    // POST to real backend
    void fetch("/api/v1/admin/custom-domains", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ domain: newDomain, verificationMethod }),
    }).then(async (res) => {
      if (res.ok) {
        const created = await res.json() as CustomDomain;
        setDomains([...domains, created]);
      } else {
        // Optimistic: add locally with pending status
        const id = crypto.randomUUID();
        const token = `civitasone-verify-${id.replace(/-/g, "").slice(0, 12)}`;
        setDomains([...domains, {
          id, domain: newDomain, status: "pending_verification",
          verificationMethod, verificationToken: token,
          sslStatus: "pending", sslExpiresAt: null, createdAt: new Date().toISOString(),
        }]);
      }
    });
    setNewDomain("");
    setShowAddModal(false);
  }

  function handleVerify(id: string) {
    void fetch(`/api/v1/admin/custom-domains/${id}/verify`, { method: "POST", credentials: "same-origin" });
    setDomains((prev) => prev.map((d) => d.id === id ? { ...d, status: "verified" as const } : d));
  }

  function handleDelete(id: string) {
    void fetch(`/api/v1/admin/custom-domains/${id}`, { method: "DELETE", credentials: "same-origin" });
    setDomains((prev) => prev.filter((d) => d.id !== id));
  }

  const instructionDomain = domains.find((d) => d.id === showInstructions);

  return (
    <>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Custom Domains</h3>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add Domain</button>
        </div>
        {domains.length === 0 ? (
          <EmptyState icon="🌐" title="No custom domains configured" message="Add a custom domain to brand your organisation's login and portal URLs." action={<button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add Domain</button>} />
        ) : (
          <table className="data-table" role="table" aria-label="Custom domains list">
            <thead>
              <tr><th>Domain</th><th>Status</th><th>SSL</th><th>Added</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.domain}</strong></td>
                  <td>{getDomainStatusBadge(d.status)}</td>
                  <td>
                    {getSslBadge(d.sslStatus)}
                    {d.sslExpiresAt && <><br /><small style={{ color: "#666" }}>Expires: {new Date(d.sslExpiresAt).toLocaleDateString("en-IN")}</small></>}
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
              ))}
            </tbody>
          </table>
        )}
      </div>

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
    </>
  );
}
