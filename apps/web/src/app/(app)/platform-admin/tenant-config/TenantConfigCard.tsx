"use client";

import { useState } from "react";
import { Button } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { featureLabel } from "@/lib/labels";
import type { AdminTenantConfig } from "@/app/_data/loaders";

export type TenantConfig = AdminTenantConfig;

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line)", alignItems: "start" }}>
      <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>{label}</span>
      <span style={{ fontSize: 13.5, color: "var(--ink)", fontFamily: mono ? "monospace" : "inherit" }}>{value}</span>
    </div>
  );
}

/** A value the platform does not track yet — shown honestly, never fabricated. */
function NotTracked() {
  return <span style={{ color: "var(--ink2)", fontStyle: "italic" }}>Not tracked</span>;
}

/**
 * GAP-PLATFORM-ADMIN-TENANT-CONFIG-04: an accessible copy control. Each button
 * carries a distinct accessible name ("Copy tenant ID", not three identical
 * "Copy"s), the "Copied!"/error result is announced through an aria-live
 * region, and a clipboard rejection (insecure context) surfaces a visible
 * error instead of silently doing nothing.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  function onCopy() {
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clip || typeof clip.writeText !== "function") {
      setState("error");
      return;
    }
    void clip.writeText(value).then(
      () => { setState("copied"); setTimeout(() => setState("idle"), 1500); },
      () => { setState("error"); },
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Button variant="ghost" size="sm" aria-label={`Copy ${label}`} onClick={onCopy} style={{ fontSize: 12 }}>
        Copy
      </Button>
      <span role="status" aria-live="polite" style={{ fontSize: 12, color: state === "error" ? "var(--bad, #b42318)" : "var(--primary-d)" }}>
        {state === "copied" ? `${label} copied` : state === "error" ? "Copy failed — select and copy manually" : ""}
      </span>
    </span>
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
    <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "var(--primary-light, #eff6ff)", color: "var(--primary-d, #1e40af)", border: "1px solid #bfdbfe", marginInlineEnd: 4, marginBottom: 4, display: "inline-block" }}>
      {featureLabel(feature)}
    </span>
  );
}

/* ─── Component ─────────────────────────────────────────────────────── */
export function TenantConfigCard({ config, daysLeft, isPlatformAdmin = false }: {
  config: TenantConfig;
  /**
   * GAP-PLATFORM-ADMIN-TENANT-CONFIG-05: whole IST calendar days until the
   * licence expiry, computed ON THE SERVER (page.tsx) with daysUntilIST and
   * passed in — so there is no Date.now() in this client render to mismatch
   * between SSR and hydration, and the count is IST-correct (expiry day reads
   * 0, not a timezone-skewed ±1). null when no licence date is on record.
   */
  daysLeft: number | null;
  isPlatformAdmin?: boolean;
}) {
  const licenseStatus = daysLeft === null ? "mut" : daysLeft < 0 ? "bad" : daysLeft < 30 ? "warn" : "good";
  const showInfra = isPlatformAdmin && (config.dbSchema || config.keycloakRealm);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Identity */}
      <div className="card">
        <div className="card-h">
          <h3 style={{ margin: 0 }}>Tenant Identity</h3>
        </div>
        <Row label="Tenant ID" value={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <span className="mono">{config.tenantId}</span>
            <CopyButton value={config.tenantId} label="tenant ID" />
          </span>
        } />
        <Row label="Tenant name" value={config.tenantName} />
        <Row label="Domain" value={<span className="mono">{config.domain}</span>} mono />
        {config.edition && <Row label="Edition" value={config.edition} />}
        {config.region && <Row label="Region" value={config.region} />}
      </div>

      {/* Infrastructure — platform-admin only (TENANT-CONFIG-02) */}
      {showInfra && (
        <div className="card">
          <div className="card-h"><h3 style={{ margin: 0 }}>Infrastructure</h3></div>
          {config.dbSchema && (
            <Row label="Database schema" value={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <span className="mono">{config.dbSchema}</span>
                <CopyButton value={config.dbSchema} label="database schema" />
              </span>
            } />
          )}
          {config.keycloakRealm && (
            <Row label="Keycloak realm" value={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <span className="mono">{config.keycloakRealm}</span>
                <CopyButton value={config.keycloakRealm} label="Keycloak realm" />
              </span>
            } />
          )}
          <Row label="Storage" value={
            config.storageUsedGb !== null && config.storageQuotaGb !== null
              ? <StorageBar used={config.storageUsedGb} quota={config.storageQuotaGb} />
              : <NotTracked />
          } />
        </div>
      )}

      {/* License */}
      <div className="card">
        <div className="card-h">
          <h3 style={{ margin: 0 }}>License</h3>
          {config.licensedUntil && (
            <span className={`pill ${licenseStatus}`} style={{ fontSize: 11 }}>
              {daysLeft === null ? "Unknown" : daysLeft < 0 ? "Expired" : daysLeft < 30 ? `Expires in ${daysLeft}d` : "Valid"}
            </span>
          )}
        </div>
        <Row label="License type" value={config.licenseType ?? <NotTracked />} />
        <Row label="Valid until" value={
          config.licensedUntil
            ? <span>
                {formatIndianDate(config.licensedUntil)}
                {daysLeft !== null && daysLeft < 30 && daysLeft >= 0 && (
                  <span style={{ marginInlineStart: 8, fontSize: 12, color: "var(--warn, #b54708)", fontWeight: 700 }}>
                    Renew within {daysLeft} day{daysLeft === 1 ? "" : "s"}
                  </span>
                )}
              </span>
            : <NotTracked />
        } />
        <Row label="Licensed seats" value={config.licensedSeats !== null ? config.licensedSeats.toLocaleString("en-IN") : <NotTracked />} />
        <Row label="Active seats" value={
          config.activeSeats !== null && config.licensedSeats !== null && config.licensedSeats > 0
            ? <span>
                {config.activeSeats.toLocaleString("en-IN")}
                <span style={{ marginInlineStart: 8, fontSize: 12, color: "var(--ink2)" }}>
                  ({Math.round((config.activeSeats / config.licensedSeats) * 100)}% used)
                </span>
              </span>
            : config.activeSeats !== null ? config.activeSeats.toLocaleString("en-IN") : <NotTracked />
        } />
      </div>

      {/* Features */}
      <div className="card">
        <div className="card-h"><h3 style={{ margin: 0 }}>Enabled features</h3><span className="pill info">{config.features.length} active</span></div>
        <div style={{ padding: "12px 16px" }}>
          {config.features.length > 0
            ? config.features.map((f) => <FeatureBadge key={f} feature={f} />)
            : <span style={{ fontSize: 13, color: "var(--ink2)" }}>No features are enabled for this office.</span>}
        </div>
      </div>
    </div>
  );
}
