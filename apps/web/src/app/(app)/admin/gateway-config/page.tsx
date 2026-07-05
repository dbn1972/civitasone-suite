"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";

type GatewayConfig = {
  jwtEdgeVerify: "true" | "audit" | "off";
  upstreamTimeoutMs: number;
  cbFailureThreshold: number;
  cbRecoveryMs: number;
  rateLimitMax: number;
  rateLimitTenantMax: number;
  authRateLimitMax: number;
  bodyLimitBytes: number;
};

type BreakerState = { service: string; state: string };

export default function GatewayConfigPage() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [breakers, setBreakers] = useState<BreakerState[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/platform-config/gateway");
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const body = await res.json();
      setConfig(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gateway config");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBreakers = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/breakers");
      if (res.ok) {
        const body = await res.json();
        setBreakers(body.breakers ?? []);
      }
    } catch {
      // Non-critical — breaker state is informational
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchBreakers();
  }, [fetchConfig, fetchBreakers]);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/v1/admin/platform-config/gateway", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Save failed: ${res.status}`);
      }
      setSuccess("Gateway configuration updated successfully");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function updateField<K extends keyof GatewayConfig>(key: K, value: GatewayConfig[K]) {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

  if (loading) {
    return (
      <main className="page-main wrap">
        <PageHeader title="API Gateway Configuration" subtitle="Loading..." back="/admin" />
        <div style={{ textAlign: "center", padding: 48 }}>Loading gateway configuration...</div>
      </main>
    );
  }

  const openBreakers = breakers.filter((b) => b.state === "open").length;
  const halfOpenBreakers = breakers.filter((b) => b.state === "half-open").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="API Gateway Configuration" subtitle="Runtime-configurable gateway parameters. Changes take effect immediately." back="/admin" />

      <StatGrid>
        <StatCard icon="🛡️" iconBg="#eef2ff" label="JWT Verification" value={config?.jwtEdgeVerify === "true" ? "Enforcing" : config?.jwtEdgeVerify === "audit" ? "Audit" : "Off"} />
        <StatCard icon="⚡" iconBg="#ecfdf3" label="Upstream Timeout" value={`${(config?.upstreamTimeoutMs ?? 15000) / 1000}s`} />
        <StatCard icon="🔌" iconBg={openBreakers > 0 ? "#fef2f2" : "#ecfdf3"} label="Circuit Breakers" value={openBreakers > 0 ? `${openBreakers} open` : "All closed"} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Rate Limit" value={`${config?.rateLimitMax ?? 1000}/min`} />
      </StatGrid>

      {error && (
        <div className="card" style={{ marginTop: 16, background: "#fef2f2", border: "1px solid #fecaca", padding: 12, borderRadius: 8 }}>
          <span style={{ color: "#dc2626" }}>⚠️ {error}</span>
        </div>
      )}

      {success && (
        <div className="card" style={{ marginTop: 16, background: "#ecfdf5", border: "1px solid #a7f3d0", padding: 12, borderRadius: 8 }}>
          <span style={{ color: "#059669" }}>✓ {success}</span>
        </div>
      )}

      {config && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
          {/* Security Settings */}
          <div className="card">
            <div className="card-h"><h3>Security</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup label="JWT Edge Verification" hint="Verify token signatures at the gateway before proxying to upstream services.">
                <select
                  value={config.jwtEdgeVerify}
                  onChange={(e) => updateField("jwtEdgeVerify", e.target.value as GatewayConfig["jwtEdgeVerify"])}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                >
                  <option value="true">Enforce (reject invalid tokens)</option>
                  <option value="audit">Audit (log but allow)</option>
                  <option value="off">Off (skip verification)</option>
                </select>
              </FieldGroup>

              <FieldGroup label="Auth Rate Limit" hint="Max login attempts per minute per username/IP (brute-force protection).">
                <NumberInput value={config.authRateLimitMax} min={3} max={1000} onChange={(v) => updateField("authRateLimitMax", v)} suffix="req/min" />
              </FieldGroup>

              <FieldGroup label="Request Body Limit" hint="Maximum request body size accepted by the gateway.">
                <NumberInput value={config.bodyLimitBytes} min={1024} max={52428800} step={1024} onChange={(v) => updateField("bodyLimitBytes", v)} suffix="bytes" />
                <span style={{ fontSize: 12, color: "#6b7280" }}>{formatBytes(config.bodyLimitBytes)}</span>
              </FieldGroup>
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="card">
            <div className="card-h"><h3>Rate Limiting</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup label="Global Rate Limit" hint="Maximum requests per minute across all tenants combined.">
                <NumberInput value={config.rateLimitMax} min={10} max={100000} onChange={(v) => updateField("rateLimitMax", v)} suffix="req/min" />
              </FieldGroup>

              <FieldGroup label="Per-Tenant Rate Limit" hint="Maximum requests per minute for a single tenant.">
                <NumberInput value={config.rateLimitTenantMax} min={10} max={10000} onChange={(v) => updateField("rateLimitTenantMax", v)} suffix="req/min" />
              </FieldGroup>
            </div>
          </div>

          {/* Circuit Breaker */}
          <div className="card">
            <div className="card-h"><h3>Circuit Breaker</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup label="Failure Threshold" hint="Number of consecutive 5xx errors before the breaker trips open.">
                <NumberInput value={config.cbFailureThreshold} min={1} max={50} onChange={(v) => updateField("cbFailureThreshold", v)} suffix="failures" />
              </FieldGroup>

              <FieldGroup label="Recovery Window" hint="How long the breaker stays open before probing again.">
                <NumberInput value={config.cbRecoveryMs} min={1000} max={300000} step={1000} onChange={(v) => updateField("cbRecoveryMs", v)} suffix="ms" />
                <span style={{ fontSize: 12, color: "#6b7280" }}>{(config.cbRecoveryMs / 1000).toFixed(0)}s</span>
              </FieldGroup>

              <FieldGroup label="Upstream Timeout" hint="Max time to wait for an upstream service response.">
                <NumberInput value={config.upstreamTimeoutMs} min={1000} max={120000} step={1000} onChange={(v) => updateField("upstreamTimeoutMs", v)} suffix="ms" />
                <span style={{ fontSize: 12, color: "#6b7280" }}>{(config.upstreamTimeoutMs / 1000).toFixed(0)}s</span>
              </FieldGroup>
            </div>
          </div>

          {/* Breaker States */}
          <div className="card">
            <div className="card-h"><h3>Circuit Breaker Status</h3></div>
            <div style={{ padding: 16 }}>
              {breakers.length === 0 ? (
                <p style={{ color: "#6b7280", fontSize: 14 }}>No upstream services have been contacted yet. Breaker states appear after the first request to each service.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {breakers.map((b) => (
                    <div key={b.service} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 13 }}>{b.service}</span>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: b.state === "closed" ? "#ecfdf5" : b.state === "open" ? "#fef2f2" : "#fffaeb",
                        color: b.state === "closed" ? "#059669" : b.state === "open" ? "#dc2626" : "#d97706",
                      }}>
                        {b.state}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save button */}
      {config && (
        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              background: saving ? "#9ca3af" : "#4f46e5",
              color: "white",
              fontWeight: 600,
              border: "none",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}
    </main>
  );
}

function FieldGroup({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 4 }}>{label}</label>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>{hint}</p>
      {children}
    </div>
  );
}

function NumberInput({ value, min, max, step, onChange, suffix }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
      />
      <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>{suffix}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
