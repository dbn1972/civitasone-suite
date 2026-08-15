"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 } as const;
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 4 } as const;

type Service = {
  id: string;
  name: string;
  endpoint: string;
  type: string;
  status: "healthy" | "degraded" | "unknown";
  lastScanned: string;
};

const MOCK_SERVICES: Service[] = [
  { id: "1", name: "HRMS Service", endpoint: "http://hrms:4000", type: "internal", status: "healthy", lastScanned: "2 min ago" },
  { id: "2", name: "CRM Service", endpoint: "http://crm:4001", type: "internal", status: "healthy", lastScanned: "2 min ago" },
  { id: "3", name: "Finance Service", endpoint: "http://finance:4002", type: "internal", status: "degraded", lastScanned: "5 min ago" },
  { id: "4", name: "Audit Service", endpoint: "http://audit:4003", type: "internal", status: "healthy", lastScanned: "2 min ago" },
  { id: "5", name: "DigiLocker Gateway", endpoint: "https://digilocker.gov.in/api", type: "external", status: "healthy", lastScanned: "10 min ago" },
  { id: "6", name: "PFMS Gateway", endpoint: "https://pfms.nic.in/api", type: "external", status: "unknown", lastScanned: "30 min ago" },
];

function statusColor(s: Service["status"]) {
  return { healthy: "#059669", degraded: "#d97706", unknown: "#6b7280" }[s];
}

export default function AdminDiscoveryPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [scanEndpoint, setScanEndpoint] = useState("");
  const [scanNotes, setScanNotes] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    fetch("/api/v1/admin/discovery/services")
      .then((r) => r.json())
      .then((body) => { setServices(body.data ?? MOCK_SERVICES); })
      .catch(() => { setServices(MOCK_SERVICES); })
      .finally(() => { setIsLoading(false); });
  }, []);

  const filtered = (isLoading ? [] : services).filter((s) => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.endpoint.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || s.type === typeFilter;
    return matchSearch && matchType;
  });

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!scanEndpoint.trim()) return;
    setScanning(true);
    setScanError(null);
    setScanSuccess(null);
    try {
      const res = await fetch("/api/v1/admin/discovery/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: scanEndpoint, notes: scanNotes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Scan failed: ${res.status}`);
      }
      setScanSuccess(`Scan initiated for ${scanEndpoint}. Results will appear shortly.`);
      setScanEndpoint("");
      setScanNotes("");
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan request failed.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Service Discovery"
        subtitle="Scan and monitor all internal and external services connected to the platform."
        back="/admin"
      />

      {/* Inline scan form */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h"><h3>Initiate Scan</h3></div>
        <form onSubmit={handleScan} style={{ padding: 20 }}>
          {scanError && (
            <div
              role="alert"
              aria-live="polite"
              style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}
            >
              {scanError}
            </div>
          )}
          {scanSuccess && (
            <div
              role="status"
              aria-live="polite"
              style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}
            >
              {scanSuccess}
            </div>
          )}

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginBottom: 14 }}>
            <div>
              <label htmlFor="discovery-endpoint" style={labelStyle}>
                Service Endpoint *
              </label>
              <input
                id="discovery-endpoint"
                type="url"
                value={scanEndpoint}
                onChange={(e) => setScanEndpoint(e.target.value)}
                placeholder="https://service.example.gov.in"
                style={inputStyle}
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="discovery-notes" style={labelStyle}>
                Notes
              </label>
              <textarea
                id="discovery-notes"
                value={scanNotes}
                onChange={(e) => setScanNotes(e.target.value)}
                placeholder="Optional context for this scan…"
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={scanning}
            style={{
              padding: "9px 22px",
              borderRadius: 8,
              background: scanning ? "#9ca3af" : "#4f46e5",
              color: "#fff",
              fontWeight: 600,
              border: "none",
              cursor: scanning ? "not-allowed" : "pointer",
              fontSize: 14,
            }}
          >
            {scanning ? "Scanning…" : "Run Scan"}
          </button>
        </form>
      </div>

      {/* Filter controls */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h">
          <h3>Registered Services</h3>
        </div>
        <div style={{ padding: "14px 20px 0", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="discovery-search" style={labelStyle}>
              Search services
            </label>
            <input
              id="discovery-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or endpoint…"
              style={inputStyle}
            />
          </div>

          <div style={{ minWidth: 180 }}>
            <label htmlFor="discovery-type-filter" style={labelStyle}>
              Service type
            </label>
            <select
              id="discovery-type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={inputStyle}
            >
              <option value="all">All types</option>
              <option value="internal">Internal</option>
              <option value="external">External</option>
            </select>
          </div>
        </div>

        <div style={{ overflowX: "auto", padding: "12px 0" }}>
          <table className="data-table" role="table" aria-label="Discovered services">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Endpoint</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Last Scanned</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [1, 2, 3, 4, 5, 6].map((n) => (
                  <tr key={n} aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((c) => (
                      <td key={c}><span style={{ display: "block", height: 16, borderRadius: 4, background: "var(--panel, #f1f5f9)", animation: "pulse 1.5s ease-in-out infinite" }} /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 24, color: "#6b7280" }}>No services match your filters.</td></tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td><code style={{ fontSize: 12 }}>{s.endpoint}</code></td>
                    <td>{s.type}</td>
                    <td>
                      <span style={{ color: statusColor(s.status), fontWeight: 600, textTransform: "capitalize" }}>
                        {s.status}
                      </span>
                    </td>
                    <td style={{ color: "#6b7280", fontSize: 13 }}>{s.lastScanned}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
