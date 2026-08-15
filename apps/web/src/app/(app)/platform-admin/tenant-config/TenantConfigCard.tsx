"use client";

import { useState } from "react";

/* ─── Types ──────────────────────────────────────────────────────────── */
export type TenantConfig = {
  tenantId: string;
  tenantName: string;
  domain: string;
  dbSchema: string;
  keycloakRealm: string;
  storageQuotaGb: number;
  storageUsedGb: number;
  licenseType: string;
  licensedUntil: string;
  licensedSeats: number;
  activeSeats: number;
  features: string[];
  createdAt: string;
};

const DEFAULT_CONFIG: TenantConfig = {
  tenantId:        "00000000-0000-0000-0000-000000000001",
  tenantName:      "Government of India — Pilot Tenant",
  domain:          "gov.civitasone.in",
  dbSchema:        "tenant_00000001",
  keycloakRealm:   "civitasone-goi-pilot",
  storageQuotaGb:  500,
  storageUsedGb:   72,
  licenseType:     "Enterprise (Government)",
  licensedUntil:   "2027-03-31",
  licensedSeats:   5000,
  activeSeats:     1243,
  features:        ["hrms", "payroll", "finance", "procurement", "audit", "pfms_integration", "digilocker", "mfa"],
  createdAt:       "2024-01-15T09:00:00Z",
};

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line)", alignItems: "start" }}>
      <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>{label}</span>
      <span style={{ fontSize: 13.5, color: "var(--ink)", fontFamily: mono ? "monospace" : "inherit" }}>{value}</span>
    </div>
  );
}

function StorageBar({ used, quota }: { used: number; quota: number }) {
  const pct = Math.min(100, Math.round((used / quota) * 100));
  const color = pct > 90 ? "var(--bad, #b42318)" : pct > 75 ? "var(--warn, #b54708)" : "var(--good, #027a48)";
  return (
    <div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--line2, #f8fafc)", overflow: "hidden", marginBottom: 4 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--ink2)" }}>{used} GB used of {quota} GB ({pct}%)</span>
    </div>
  );
}

function FeatureBadge({ feature }: { feature: string }) {
  return (
    <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "var(--primary-light, #eff6ff)", color: "var(--primary-d, #1e40af)", border: "1px solid #bfdbfe", marginRight: 4, marginBottom: 4, display: "inline-block" }}>
      {feature.replace(/_/g, " ")}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

/* ─── Component ─────────────────────────────────────────────────────── */
export function TenantConfigCard({ config = DEFAULT_CONFIG, isPlatformAdmin = false }: {
  config?: TenantConfig;
  isPlatformAdmin?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); });
  }

  const daysUntilExpiry = Math.ceil((new Date(config.licensedUntil).getTime() - Date.now()) / 86400000);
  const licenseStatus = daysUntilExpiry < 30 ? "warn" : daysUntilExpiry < 0 ? "bad" : "good";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Identity */}
      <div className="card">
        <div className="card-h">
          <h3 style={{ margin: 0 }}>Tenant Identity</h3>
          {!isPlatformAdmin && <span className="pill mut" style={{ fontSize: 11 }}>Read-only</span>}
        </div>
        <Row label="Tenant ID" value={
          <span>
            <span className="mono">{config.tenantId}</span>
            <button type="button" onClick={() => copy(config.tenantId, "id")} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--primary-d)" }}>
              {copied === "id" ? "Copied!" : "Copy"}
            </button>
          </span>
        } />
        <Row label="Tenant name" value={config.tenantName} />
        <Row label="Domain" value={<span className="mono">{config.domain}</span>} mono />
        <Row label="Created" value={formatDate(config.createdAt)} />
      </div>

      {/* Infrastructure */}
      <div className="card">
        <div className="card-h"><h3 style={{ margin: 0 }}>Infrastructure</h3></div>
        <Row label="Database schema" value={
          <span>
            <span className="mono">{config.dbSchema}</span>
            <button type="button" onClick={() => copy(config.dbSchema, "schema")} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--primary-d)" }}>
              {copied === "schema" ? "Copied!" : "Copy"}
            </button>
          </span>
        } />
        <Row label="Keycloak realm" value={
          <span>
            <span className="mono">{config.keycloakRealm}</span>
            <button type="button" onClick={() => copy(config.keycloakRealm, "realm")} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--primary-d)" }}>
              {copied === "realm" ? "Copied!" : "Copy"}
            </button>
          </span>
        } />
        <Row label="Storage" value={<StorageBar used={config.storageUsedGb} quota={config.storageQuotaGb} />} />
      </div>

      {/* License */}
      <div className="card">
        <div className="card-h">
          <h3 style={{ margin: 0 }}>License</h3>
          <span className={`pill ${licenseStatus}`} style={{ fontSize: 11 }}>
            {daysUntilExpiry < 0 ? "Expired" : daysUntilExpiry < 30 ? `Expires in ${daysUntilExpiry}d` : "Valid"}
          </span>
        </div>
        <Row label="License type" value={config.licenseType} />
        <Row label="Valid until" value={
          <span>
            {formatDate(config.licensedUntil)}
            {daysUntilExpiry < 30 && daysUntilExpiry >= 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--warn, #b54708)", fontWeight: 700 }}>
                Renew within {daysUntilExpiry} day{daysUntilExpiry === 1 ? "" : "s"}
              </span>
            )}
          </span>
        } />
        <Row label="Licensed seats" value={`${config.licensedSeats.toLocaleString("en-IN")}`} />
        <Row label="Active seats" value={
          <span>
            {config.activeSeats.toLocaleString("en-IN")}
            <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ink2)" }}>
              ({Math.round((config.activeSeats / config.licensedSeats) * 100)}% used)
            </span>
          </span>
        } />
      </div>

      {/* Features */}
      <div className="card">
        <div className="card-h"><h3 style={{ margin: 0 }}>Enabled features</h3><span className="pill info">{config.features.length} active</span></div>
        <div style={{ padding: "12px 16px" }}>
          {config.features.map((f) => <FeatureBadge key={f} feature={f} />)}
        </div>
      </div>
    </div>
  );
}
