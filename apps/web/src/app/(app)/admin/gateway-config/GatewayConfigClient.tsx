"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { z } from "zod";
import { Button, ConfirmDialog, PageHeader, StatGrid, StatCard, ErrorState, Input, Select } from "@/app/_components/ds";
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

/**
 * Numeric fields are held as `number | ""` while editing: clearing a field
 * leaves it empty (GAP-ADMIN-GATEWAY-CONFIG-04) instead of silently becoming 0.
 */
type GatewayConfigDraft = {
  [K in keyof GatewayConfig]: GatewayConfig[K] extends number ? number | "" : GatewayConfig[K];
};

/** Same bounds as admin-service platform-config gatewayConfigSchema (routes.ts). */
export const NUMERIC_BOUNDS = {
  upstreamTimeoutMs: { min: 1000, max: 120000 },
  cbFailureThreshold: { min: 1, max: 50 },
  cbRecoveryMs: { min: 1000, max: 300000 },
  rateLimitMax: { min: 10, max: 100000 },
  rateLimitTenantMax: { min: 10, max: 10000 },
  authRateLimitMax: { min: 3, max: 1000 },
  bodyLimitBytes: { min: 1024, max: 52428800 },
} as const;

function boundedInt(label: string, b: { min: number; max: number }) {
  const msg = `${label} must be a whole number from ${b.min.toLocaleString("en-IN")} to ${b.max.toLocaleString("en-IN")}.`;
  return z.number({ invalid_type_error: msg, required_error: msg }).int(msg).min(b.min, msg).max(b.max, msg);
}

const gatewayConfigSchema = z.object({
  jwtEdgeVerify: z.enum(["true", "audit", "off"]),
  upstreamTimeoutMs: boundedInt("Upstream timeout", NUMERIC_BOUNDS.upstreamTimeoutMs),
  cbFailureThreshold: boundedInt("Failure threshold", NUMERIC_BOUNDS.cbFailureThreshold),
  cbRecoveryMs: boundedInt("Recovery window", NUMERIC_BOUNDS.cbRecoveryMs),
  rateLimitMax: boundedInt("Global rate limit", NUMERIC_BOUNDS.rateLimitMax),
  rateLimitTenantMax: boundedInt("Per-tenant rate limit", NUMERIC_BOUNDS.rateLimitTenantMax),
  authRateLimitMax: boundedInt("Auth rate limit", NUMERIC_BOUNDS.authRateLimitMax),
  bodyLimitBytes: boundedInt("Request body limit", NUMERIC_BOUNDS.bodyLimitBytes),
});

/** Field -> message for every out-of-range / empty field; {} when the draft is valid. */
export function validateGatewayConfig(draft: GatewayConfigDraft): Partial<Record<keyof GatewayConfig, string>> {
  const r = gatewayConfigSchema.safeParse(draft);
  if (r.success) return {};
  const out: Partial<Record<keyof GatewayConfig, string>> = {};
  for (const issue of r.error.issues) {
    const k = issue.path[0] as keyof GatewayConfig;
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}

/**
 * GAP-ADMIN-GATEWAY-CONFIG-01: label lookup instead of an exact-match
 * ternary, so an unexpected value reads "Unknown" (not a false "Off") and a
 * failed load reads "—" (handled by the caller, never derived from null).
 */
const JWT_MODE_LABELS: Record<string, string> = { true: "Enforcing", audit: "Audit", off: "Off" };
export function jwtModeLabel(mode: string): string {
  return JWT_MODE_LABELS[mode] ?? "Unknown";
}

const FIELD_LABELS: Record<keyof GatewayConfig, string> = {
  jwtEdgeVerify: "JWT Edge Verification",
  upstreamTimeoutMs: "Upstream Timeout (ms)",
  cbFailureThreshold: "Breaker Failure Threshold",
  cbRecoveryMs: "Breaker Recovery Window (ms)",
  rateLimitMax: "Global Rate Limit (req/min)",
  rateLimitTenantMax: "Per-Tenant Rate Limit (req/min)",
  authRateLimitMax: "Auth Rate Limit (req/min)",
  bodyLimitBytes: "Request Body Limit (bytes)",
};

export type ConfigChange = { key: keyof GatewayConfig; label: string; from: string; to: string; risky: boolean };

/**
 * GAP-ADMIN-GATEWAY-CONFIG-02: the field-by-field diff shown in the
 * confirmation dialog. "Risky" = weakening edge auth or loosening a limit.
 */
export function diffGatewayConfig(before: GatewayConfigDraft, after: GatewayConfigDraft): ConfigChange[] {
  const keys = Object.keys(FIELD_LABELS) as (keyof GatewayConfig)[];
  return keys
    .filter((k) => before[k] !== after[k])
    .map((k) => {
      const from = before[k];
      const to = after[k];
      let risky = false;
      if (k === "jwtEdgeVerify") risky = to !== "true";
      else if (k === "rateLimitMax" || k === "rateLimitTenantMax" || k === "authRateLimitMax" || k === "bodyLimitBytes") {
        risky = Number(to) > Number(from);
      }
      const fmt = (v: GatewayConfigDraft[keyof GatewayConfigDraft]) => (k === "jwtEdgeVerify" ? jwtModeLabel(String(v)) : String(v));
      return { key: k, label: FIELD_LABELS[k], from: fmt(from), to: fmt(to), risky };
    });
}

export function GatewayConfigClient() {
  const [config, setConfig] = useState<GatewayConfigDraft | null>(null);
  // The last config the server confirmed (load or successful save) -- the
  // "before" side of the confirmation diff.
  const [original, setOriginal] = useState<GatewayConfig | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      setOriginal(body.data);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(formError.fromException("load", err).message);
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

  useEffect(() => {
    const controller = new AbortController()
    fetchConfig(controller.signal);
    return () => controller.abort()
  }, [fetchConfig]);

  const changes = config && original ? diffGatewayConfig(original, config) : [];
  // GAP-ADMIN-GATEWAY-CONFIG-04: client-side bounds check, same limits as the server.
  const clientErrors = config ? validateGatewayConfig(config) : {};
  const invalidCount = Object.keys(clientErrors).length;
  const fieldErr = (k: keyof GatewayConfig) => formError.fieldError(k) ?? clientErrors[k];

  async function handleSave(reason: string) {
    if (!config || changes.length === 0) return;
    if (Object.keys(validateGatewayConfig(config)).length > 0) {
      setConfirmOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    formError.clear();
    try {
      // Only the changed fields, plus the operator's reason (admin-service
      // records both, with the before/after values, in the audit log).
      const patch: Record<string, unknown> = { reason };
      for (const c of changes) patch[c.key] = config[c.key];
      const res = await fetch("/api/v1/admin/platform-config/gateway", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        setConfirmOpen(false);
        return;
      }
      setOriginal(config as GatewayConfig);
      setConfirmOpen(false);
      setSuccess("Gateway configuration updated successfully");
      setTimeout(() => setSuccess(null), 4000);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setSaving(false);
    }
  }

  function updateField<K extends keyof GatewayConfig>(key: K, value: GatewayConfigDraft[K]) {
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

  // GAP-ADMIN-GATEWAY-CONFIG-01: a failed load must not render the stat
  // cards at all -- with config === null they used to read "JWT: Off" and a
  // fabricated "15s" timeout next to the error banner.
  if (!config) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="API Gateway Configuration" subtitle="Runtime-configurable gateway parameters." back="/admin" />
        <ErrorState
          error={toHumanError("load", { area: "gateway configuration" })}
          onRetry={() => { setLoading(true); setError(null); void fetchConfig(); }}
        />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="API Gateway Configuration"
        subtitle="Runtime-configurable gateway parameters. Saved changes take effect immediately and are recorded in the audit log."
        back="/admin"
        actions={<Link className="btn ghost" href="/admin/audit-log">View audit log</Link>}
      />

      <StatGrid>
        <StatCard icon="🛡️" iconBg="var(--line2)" label="JWT Verification" value={jwtModeLabel(String(original?.jwtEdgeVerify ?? config.jwtEdgeVerify))} />
        <StatCard icon="⚡" iconBg="var(--goodbg)" label="Upstream Timeout" value={original ? `${original.upstreamTimeoutMs / 1000}s` : null} />
        <StatCard icon="🔌" iconBg="var(--line2)" label="Circuit Breakers" value={null} delta="Not available yet" />
        <StatCard icon="📊" iconBg="var(--warnbg)" label="Rate Limit" value={original ? `${original.rateLimitMax}/min` : null} />
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
        <div className="grid g-2" style={{ marginTop: 18 }}>
          {/* Security Settings */}
          <div className="card">
            <div className="card-h"><h3>Security</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup htmlFor="gw-jwt-edge-verify" label="JWT Edge Verification" hint="Verify token signatures at the gateway before proxying to upstream services." error={fieldErr("jwtEdgeVerify")}>
                <Select
                  id="gw-jwt-edge-verify"
                  value={config.jwtEdgeVerify}
                  onChange={(e) => updateField("jwtEdgeVerify", e.target.value as GatewayConfig["jwtEdgeVerify"])}
                >
                  <option value="true">Enforce (reject invalid tokens)</option>
                  <option value="audit">Audit (log but allow)</option>
                  <option value="off">Off (skip verification)</option>
                </Select>
              </FieldGroup>

              <FieldGroup htmlFor="gw-auth-rate-limit" label="Auth Rate Limit" hint="Max login attempts per minute per username/IP (brute-force protection)." error={fieldErr("authRateLimitMax")}>
                <NumberInput id="gw-auth-rate-limit" value={config.authRateLimitMax} min={3} max={1000} onChange={(v) => updateField("authRateLimitMax", v)} suffix="req/min" />
              </FieldGroup>

              <FieldGroup htmlFor="gw-body-limit" label="Request Body Limit" hint="Maximum request body size accepted by the gateway." error={fieldErr("bodyLimitBytes")}>
                <NumberInput id="gw-body-limit" value={config.bodyLimitBytes} min={1024} max={52428800} step={1024} onChange={(v) => updateField("bodyLimitBytes", v)} suffix="bytes" />
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{config.bodyLimitBytes === "" ? "" : formatBytes(config.bodyLimitBytes)}</span>
              </FieldGroup>
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="card">
            <div className="card-h"><h3>Rate Limiting</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup htmlFor="gw-rate-limit-global" label="Global Rate Limit" hint="Maximum requests per minute across all tenants combined." error={fieldErr("rateLimitMax")}>
                <NumberInput id="gw-rate-limit-global" value={config.rateLimitMax} min={10} max={100000} onChange={(v) => updateField("rateLimitMax", v)} suffix="req/min" />
              </FieldGroup>

              <FieldGroup htmlFor="gw-rate-limit-tenant" label="Per-Tenant Rate Limit" hint="Maximum requests per minute for a single tenant." error={fieldErr("rateLimitTenantMax")}>
                <NumberInput id="gw-rate-limit-tenant" value={config.rateLimitTenantMax} min={10} max={10000} onChange={(v) => updateField("rateLimitTenantMax", v)} suffix="req/min" />
              </FieldGroup>
            </div>
          </div>

          {/* Circuit Breaker */}
          <div className="card">
            <div className="card-h"><h3>Circuit Breaker</h3></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldGroup htmlFor="gw-cb-failure-threshold" label="Failure Threshold" hint="Number of consecutive 5xx errors before the breaker trips open." error={fieldErr("cbFailureThreshold")}>
                <NumberInput id="gw-cb-failure-threshold" value={config.cbFailureThreshold} min={1} max={50} onChange={(v) => updateField("cbFailureThreshold", v)} suffix="failures" />
              </FieldGroup>

              <FieldGroup htmlFor="gw-cb-recovery-window" label="Recovery Window" hint="How long the breaker stays open before probing again." error={fieldErr("cbRecoveryMs")}>
                <NumberInput id="gw-cb-recovery-window" value={config.cbRecoveryMs} min={1000} max={300000} step={1000} onChange={(v) => updateField("cbRecoveryMs", v)} suffix="ms" />
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{config.cbRecoveryMs === "" ? "" : `${(config.cbRecoveryMs / 1000).toFixed(0)}s`}</span>
              </FieldGroup>

              <FieldGroup htmlFor="gw-upstream-timeout" label="Upstream Timeout" hint="Max time to wait for an upstream service response." error={fieldErr("upstreamTimeoutMs")}>
                <NumberInput id="gw-upstream-timeout" value={config.upstreamTimeoutMs} min={1000} max={120000} step={1000} onChange={(v) => updateField("upstreamTimeoutMs", v)} suffix="ms" />
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{config.upstreamTimeoutMs === "" ? "" : `${(config.upstreamTimeoutMs / 1000).toFixed(0)}s`}</span>
              </FieldGroup>
            </div>
          </div>

          {/* Breaker States */}
          <div className="card">
            <div className="card-h"><h3>Circuit Breaker Status</h3></div>
            <div style={{ padding: 16 }}>
              {/* GAP: the gateway serves breaker state at /ops/breakers, outside /api, so neither the
                  web proxy nor a Next route can reach it. Say so instead of a dead fetch + Retry. */}
              <p style={{ color: "var(--mut)", fontSize: 14 }}>Not available yet. Live breaker states are not exposed to the console; the thresholds above still apply.</p>
            </div>
          </div>
        </div>
      )}

      {/* Save button */}
      {config && (
        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={() => setConfirmOpen(true)} disabled={saving || changes.length === 0 || invalidCount > 0} loading={saving}>
            {saving ? "Saving..." : invalidCount > 0 ? `Fix ${invalidCount} invalid field${invalidCount === 1 ? "" : "s"}` : changes.length === 0 ? "No changes" : `Review ${changes.length} change${changes.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        danger={changes.some((c) => c.risky)}
        requireReason
        minReasonLength={3}
        maxReasonLength={500}
        reasonLabel="Reason for this change (recorded in the audit log)"
        title="Apply gateway configuration changes?"
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>These apply to every request through the gateway, immediately.</p>
            <ul aria-label="Configuration changes" style={{ margin: 0, paddingLeft: 18 }}>
              {changes.map((c) => (
                <li key={c.key}>
                  <strong>{c.label}</strong>: {c.from} → {c.to}
                  {c.risky ? <span className="pill bad" style={{ marginLeft: 6 }}>weakens protection</span> : null}
                </li>
              ))}
            </ul>
          </>
        }
        confirmLabel="Apply changes"
        busy={saving}
        onConfirm={(reason) => { if (reason) void handleSave(reason); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function FieldGroup({ label, hint, error, htmlFor, children }: { label: string; hint: string; error?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 4 }}>{label}</label>
      <p style={{ fontSize: 12, color: "var(--mut)", marginBottom: 8 }}>{hint}</p>
      {children}
      {error && <span role="alert" style={{ display: "block", fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{error}</span>}
    </div>
  );
}

function NumberInput({ id, value, min, max, step, onChange, suffix }: { id?: string; value: number | ""; min: number; max: number; step?: number; onChange: (v: number | "") => void; suffix: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        // An empty field stays empty ("") -- it must not coerce to 0 and pass as a value.
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ fontSize: 12, color: "var(--mut)", whiteSpace: "nowrap" }}>{suffix}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
