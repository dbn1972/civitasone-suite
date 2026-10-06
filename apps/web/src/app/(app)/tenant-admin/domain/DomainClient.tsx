"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, ConfirmDialog } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDate } from "@/lib/formatters";
import type { CustomDomain } from "@/app/_data/loaders";

function getDomainStatusBadge(status: string) {
  switch (status) {
    case "pending_verification": return <span className="pill warn">Pending Verification</span>;
    case "verified": return <span className="pill good">Verified</span>;
    case "active": return <span className="pill good">✓ Active</span>;
    case "failed": return <span className="pill bad">Failed</span>;
    case "revoked": return <span className="pill mut">Revoked</span>;
    default: return <span className="pill mut">{status}</span>;
  }
}

function getSslBadge(status: string) {
  switch (status) {
    case "issued": return <span className="pill good">SSL Active</span>;
    case "pending": return <span className="pill info">SSL Pending</span>;
    case "expired": return <span className="pill bad">SSL Expired</span>;
    default: return <span className="pill mut">{status}</span>;
  }
}

export function DomainClient({ domains: initialDomains, source }: { domains: CustomDomain[]; source: "api" | "error" }) {
  const router = useRouter();
  const { data: seededDomains, provenance, offline, cachedAt } = useSeededResource("admin.domains", initialDomains, source, (d) => d.length === 0);
  const [domains, setDomains] = useState<CustomDomain[]>(seededDomains);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showInstructions, setShowInstructions] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [verificationMethod, setVerificationMethod] = useState<"dns_txt" | "dns_cname">("dns_txt");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomDomain | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rowMessage, setRowMessage] = useState("");
  const addError = useFormError("custom domain");
  const deleteError = useFormError("custom domain");

  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    addError.clear();
    try {
      // GAP-TENANT-ADMIN-DOMAIN-02: consistent proxy path; never fabricate a
      // local verification token on failure.
      const res = await fetch("/api/proxy/v1/admin/custom-domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ domain: newDomain, verificationMethod }),
      });
      if (!res.ok) {
        await addError.fromResponse(res, "save");
        return; // keep modal open, keep input, add no row
      }
      // Backend is CQRS (202 Accepted) — reflect server truth via refresh
      // rather than appending the accepted envelope as if it were a domain row.
      setNewDomain("");
      setShowAddModal(false);
      router.refresh();
    } catch (caught) {
      addError.fromException("save", caught);
    }
  }

  async function handleVerify(id: string) {
    // GAP-TENANT-ADMIN-DOMAIN-03: await the result; never flip to "verified"
    // locally before the server confirms.
    setBusyId(id);
    setRowMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/admin/custom-domains/${id}/verify`, { method: "POST", credentials: "same-origin" });
      if (!res.ok) {
        setRowMessage("Verification did not complete. Check the DNS record and try again.");
        return;
      }
      // CQRS 202: the verify result is applied asynchronously by the consumer,
      // so reflect server truth via refresh rather than guessing a status
      // locally (never flip to "verified" without the server confirming).
      setRowMessage("Verification requested — status will update shortly.");
      router.refresh();
    } catch {
      setRowMessage("Could not reach the server to verify this domain.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete(reason?: string) {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setDeleting(true);
    deleteError.clear();
    try {
      // GAP-TENANT-ADMIN-DOMAIN-01: await DELETE, check res.ok, send reason;
      // only remove the row on success.
      const res = await fetch(`/api/proxy/v1/admin/custom-domains/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        await deleteError.fromResponse(res, "save");
        return; // keep the row
      }
      setDomains((prev) => prev.filter((d) => d.id !== id));
      setPendingDelete(null);
    } catch (caught) {
      deleteError.fromException("save", caught);
    } finally {
      setDeleting(false);
    }
  }

  const instructionDomain = domains.find((d) => d.id === showInstructions);

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Custom Domains</h3>
          <Button onClick={() => { addError.clear(); setShowAddModal(true); }}>+ Add Domain</Button>
        </div>
        {domains.length === 0 ? (
          <EmptyState icon="🌐" title="No custom domains configured" message="Add a custom domain to brand your organisation's login and portal URLs." action={<Button onClick={() => setShowAddModal(true)}>+ Add Domain</Button>} />
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="data-table" role="table" aria-label="Custom domains list">
            <thead>
              <tr><th scope="col">Domain</th><th scope="col">Status</th><th scope="col">SSL</th><th scope="col">Added</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.domain}</strong></td>
                  <td>{getDomainStatusBadge(d.status)}</td>
                  <td>
                    {getSslBadge(d.sslStatus)}
                    {d.sslExpiresAt && <><br /><small style={{ color: "var(--ink2)" }}>Expires: {formatIndianDate(d.sslExpiresAt)}</small></>}
                  </td>
                  <td>{formatIndianDate(d.createdAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {d.status === "pending_verification" && (
                        <Button size="sm" disabled={busyId === d.id} onClick={() => void handleVerify(d.id)} style={{ fontSize: 12 }}>
                          {busyId === d.id ? "Verifying…" : "✓ Verify"}
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setShowInstructions(d.id)} style={{ fontSize: 12 }}>📋 DNS</Button>
                      {/* GAP-TENANT-ADMIN-DOMAIN-04: labelled, destructive control that
                          opens a ConfirmDialog (DOMAIN-01) instead of deleting on click. */}
                      <Button
                        size="sm"
                        variant="danger"
                        aria-label={`Remove ${d.domain}`}
                        title={`Remove ${d.domain}`}
                        onClick={() => { deleteError.clear(); setPendingDelete(d); }}
                        style={{ fontSize: 12 }}
                      >
                        🗑️
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <div role="status" aria-live="polite" style={{ padding: "0 16px 12px", fontSize: 12, color: "var(--ink2)" }}>{rowMessage}</div>
      </div>

      {/* GAP-TENANT-ADMIN-DOMAIN-01: destructive delete requires confirmation + reason. */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove domain"
        danger
        requireReason
        minReasonLength={5}
        reasonLabel="Reason for removal (recorded in the audit log)"
        confirmLabel="Remove domain"
        busy={deleting}
        errorMessage={deleteError.message || undefined}
        description={
          <>
            Removing <b>{pendingDelete?.domain}</b> stops any login/portal URLs on that domain from working. This cannot be undone.
          </>
        }
        onConfirm={(reason) => void confirmDelete(reason)}
        onCancel={() => { if (!deleting) { setPendingDelete(null); deleteError.clear(); } }}
      />

      {showAddModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Add Custom Domain">
          {/* GAP-TENANT-ADMIN-DOMAIN-04: token-based colours (dark-mode safe). */}
          <div className="modal-content" style={{ maxWidth: 450, padding: 24, borderRadius: 8, background: "var(--bg, #fff)", color: "var(--ink)" }}>
            <h3>Register Custom Domain</h3>
            <form onSubmit={handleAddDomain}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="domain-name">Domain Name</label>
                <input id="domain-name" type="text" className="ta-input" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="erp.yourorg.gov.in" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="verify-method">Verification Method</label>
                <select id="verify-method" className="ta-input" value={verificationMethod} onChange={(e) => setVerificationMethod(e.target.value as "dns_txt" | "dns_cname")}>
                  <option value="dns_txt">DNS TXT Record</option>
                  <option value="dns_cname">DNS CNAME Record</option>
                </select>
              </div>
              <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad)", minHeight: 18 }}>{addError.message}</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button type="button" variant="ghost" onClick={() => { setShowAddModal(false); addError.clear(); }}>Cancel</Button>
                <Button type="submit">Register</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showInstructions && instructionDomain && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="DNS Instructions">
          <div className="modal-content" style={{ maxWidth: 520, padding: 24, borderRadius: 8, background: "var(--bg, #fff)", color: "var(--ink)" }}>
            <h3>DNS Verification Instructions</h3>
            <p style={{ color: "var(--ink2)", margin: "8px 0 16px" }}>Add the following record to your DNS configuration:</p>
            <div style={{ background: "var(--surface2, #f1f5f9)", color: "var(--ink)", padding: 16, borderRadius: 6, fontFamily: "monospace", fontSize: 13 }}>
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
            <Button
              size="sm" style={{ marginTop: 12 }}
              onClick={() => navigator.clipboard.writeText(instructionDomain.verificationToken)}
              aria-label="Copy verification token"
            >
              📋 Copy Token
            </Button>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <Button variant="ghost" onClick={() => setShowInstructions(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
