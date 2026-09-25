"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, PageHeader, StatGrid, StatCard, ErrorState } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";

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
  const [breakersError, setBreakersError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const formError = useFormError("gateway configuration");

  const fetchConfig = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/v1/admin/platform-config/gateway", { signal });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        setError(resolved.message);
        return;
      }
      const body = await res.json();
      setConfig(body.data);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(formError.fromException("load").message);
      }
    } finally {
      setLoading(false);
    }
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe and
    // avoids re-creating fetchConfig (and re-running its effect) every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, []);

  const fetchBreakers = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/ops/breakers", { signal });
      if (res.ok) {
        const body = await res.json();
        setBreakers(body.breakers ?? []);
        setBreakersError(false);
      } else {
        // UX-013: a failed status check must not look identical to "no
        // breakers contacted yet" — an ops clerk relying on this panel
        // during an incident needs to know the check itself is broken.
        setBreakersError(true);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setBreakersError(true);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController()
    fetchConfig(controller.signal);
    fetchBreakers(controller.signal);
    return () => controller.abort()
  }, [fetchConfig, fetchBreakers]);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    formError.clear();
    try {
      const res = await fetch("/api/v1/admin/platform-config/gateway", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setSuccess("Gateway configuration updated successfully");
      setTimeout(() => setSuccess(null), 4000);
    } catch {
      setError(formError.fromException("save").message);
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
      <div className="page-main wrap">
        <PageHeader title="API Gateway Configuration" subtitle="Loading..." back="/admin" />
        <div style={{ textAlign: "center", padding: 48 }}>Loading gateway configuration...</div>
      </div>
    );
  }

  const openBreakers = breakers.filter((b) => b.state === "open").length;
  const halfOpenBreakers = breakers.filter((b) => b.state === "half-open").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="API Gateway Configuration" subtitle="Runtime-configurable gateway parameters. Changes take effect immediately." back="/admin" />

      <StatGrid>
        <StatCard icon="🛡️" iconBg="#eef2ff" label="JWT Verification" value={config?.jwtEdgeVerify === "true" ? "Enforcing" : config?.jwtEdgeVerify === "audit" ? "Audit" : "Off"} />
        <StatCard icon="⚡" iconBg="#ecfdf3" label="Upstream Timeout" value={`${(config?.upstreamTimeoutMs ?? 15000) / 1000}s`} />
        <StatCard icon="🔌" iconBg={breakersError ? "#f2f4f7" : openBreakers > 0 ? "#fef2f2" : "#ecfdf3"} label="Circuit Breakers" value={breakersError ? "—" : openBreakers > 0 ? `${openBreakers} open` : "All closed"} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Rate Limit" value={`${config?.rateLimitMax ?? 1000}/min`} />
      </StatGrid>

      {error && (
        <div className="card" style={{ marginTop: 16, background: "var(--badbg)", border: "1px solid var(--badbd)", padding: 12, borderRadius: 8 }}>
          <span style={{ color: "var(--bad)" }}>⚠️ {error}</span>
        </div>
      )}

      {success && (
        <div className="card" style={{ marginTop: 16, background: "var(--goodbg)", border: "1px solid var(--goodbd)", padding: 12, borderRadius: 8 }}>
          <span style={{ color: "var(--good)" }}>✓ {success}</span>
        </div>
      )}

      {config && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
          {/* Security Settings */}
          <div className="card">
            <div className="card-h"><h3>Security</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup htmlFor="gw-jwt-edge-verify" label="JWT Edge Verification" hint="Verify token signatures at the gateway before proxying to upstream services." error={formError.fieldError("jwtEdgeVerify")}>
                <select
                  id="gw-jwt-edge-verify"
                  value={config.jwtEdgeVerify}
                  onChange={(e) => updateField("jwtEdgeVerify", e.target.value as GatewayConfig["jwtEdgeVerify"])}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                >
                  <option value="true">Enforce (reject invalid tokens)</option>
                  <option value="audit">Audit (log but allow)</option>
                  <option value="off">Off (skip verification)</option>
                </select>
              </FieldGroup>

              <FieldGroup htmlFor="gw-auth-rate-limit" label="Auth Rate Limit" hint="Max login attempts per minute per username/IP (brute-force protection)." error={formError.fieldError("authRateLimitMax")}>
                <NumberInput id="gw-auth-rate-limit" value={config.authRateLimitMax} min={3} max={1000} onChange={(v) => updateField("authRateLimitMax", v)} suffix="req/min" />
              </FieldGroup>

              <FieldGroup htmlFor="gw-body-limit" label="Request Body Limit" hint="Maximum request body size accepted by the gateway." error={formError.fieldError("bodyLimitBytes")}>
                <NumberInput id="gw-body-limit" value={config.bodyLimitBytes} min={1024} max={52428800} step={1024} onChange={(v) => updateField("bodyLimitBytes", v)} suffix="bytes" />
                <span style={{ fontSize: 12, color: "#6b7280" }}>{formatBytes(config.bodyLimitBytes)}</span>
              </FieldGroup>
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="card">
            <div className="card-h"><h3>Rate Limiting</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup htmlFor="gw-rate-limit-global" label="Global Rate Limit" hint="Maximum requests per minute across all tenants combined." error={formError.fieldError("rateLimitMax")}>
                <NumberInput id="gw-rate-limit-global" value={config.rateLimitMax} min={10} max={100000} onChange={(v) => updateField("rateLimitMax", v)} suffix="req/min" />
              </FieldGroup>

              <FieldGroup htmlFor="gw-rate-limit-tenant" label="Per-Tenant Rate Limit" hint="Maximum requests per minute for a single tenant." error={formError.fieldError("rateLimitTenantMax")}>
                <NumberInput id="gw-rate-limit-tenant" value={config.rateLimitTenantMax} min={10} max={10000} onChange={(v) => updateField("rateLimitTenantMax", v)} suffix="req/min" />
              </FieldGroup>
            </div>
          </div>

          {/* Circuit Breaker */}
          <div className="card">
            <div className="card-h"><h3>Circuit Breaker</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup htmlFor="gw-cb-failure-threshold" label="Failure Threshold" hint="Number of consecutive 5xx errors before the breaker trips open." error={formError.fieldError("cbFailureThreshold")}>
                <NumberInput id="gw-cb-failure-threshold" value={config.cbFailureThreshold} min={1} max={50} onChange={(v) => updateField("cbFailureThreshold", v)} suffix="failures" />
              </FieldGroup>

              <FieldGroup htmlFor="gw-cb-recovery-window" label="Recovery Window" hint="How long the breaker stays open before probing again." error={formError.fieldError("cbRecoveryMs")}>
                <NumberInput id="gw-cb-recovery-window" value={config.cbRecoveryMs} min={1000} max={300000} step={1000} onChange={(v) => updateField("cbRecoveryMs", v)} suffix="ms" />
                <span style={{ fontSize: 12, color: "#6b7280" }}>{(config.cbRecoveryMs / 1000).toFixed(0)}s</span>
              </FieldGroup>

              <FieldGroup htmlFor="gw-upstream-timeout" label="Upstream Timeout" hint="Max time to wait for an upstream service response." error={formError.fieldError("upstreamTimeoutMs")}>
                <NumberInput id="gw-upstream-timeout" value={config.upstreamTimeoutMs} min={1000} max={120000} step={1000} onChange={(v) => updateField("upstreamTimeoutMs", v)} suffix="ms" />
                <span style={{ fontSize: 12, color: "#6b7280" }}>{(config.upstreamTimeoutMs / 1000).toFixed(0)}s</span>
              </FieldGroup>
            </div>
          </div>

          {/* Breaker States */}
          <div className="card">
            <div className="card-h"><h3>Circuit Breaker Status</h3></div>
            <div style={{ padding: 16 }}>
              {breakersError ? (
                <ErrorState error={toHumanError("load", { area: "circuit breaker status" })} onRetry={() => void fetchBreakers()} />
              ) : breakers.length === 0 ? (
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
          <Button onClick={handleSave} disabled={saving} loading={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

function FieldGroup({ label, hint, error, htmlFor, children }: { label: string; hint: string; error?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 4 }}>{label}</label>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>{hint}</p>
      {children}
      {error && <span role="alert" style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 4 }}>{error}</span>}
    </div>
  );
}

function NumberInput({ id, value, min, max, step, onChange, suffix }: { id?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        id={id}
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
