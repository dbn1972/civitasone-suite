"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import {
  CATEGORIES,
  ENV_SCOPES,
  PROVIDER_META,
  type EnvScope,
  type IntegrationRow,
  type ProviderMeta,
} from "./_components/providers";
import { IntegrationDrawer, StatusBadge } from "./_components/IntegrationDrawer";

const API = "/api/proxy/v1/admin/integrations";

export default function IntegrationsPage() {
  const [env, setEnv] = useState<EnvScope>("prod");
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ProviderMeta | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API, { signal });
      if (!res.ok) throw new Error(`Failed to load integrations (${res.status})`);
      const body = await res.json();
      setRows((body.data ?? []) as IntegrationRow[]);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message || "Failed to load integrations");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load]);

  const forEnv = useMemo(() => rows.filter((r) => r.envScope === env), [rows, env]);
  const byProvider = useMemo(() => {
    const m = new Map<string, IntegrationRow>();
    for (const r of forEnv) m.set(r.provider, r);
    return m;
  }, [forEnv]);

  const connected = forEnv.filter((r) => r.status === "connected").length;
  const failed = forEnv.filter((r) => r.status === "failed").length;
  const configured = forEnv.filter((r) => r.hasSecret || r.enabled).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Integrations"
        subtitle="External endpoints for AI, messaging, email, payments and files. Secrets are encrypted at rest and never displayed."
        back="/admin"
      />

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eef2ff" label="Providers" value={String(PROVIDER_META.length)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Connected" value={String(connected)} />
        <StatCard icon="⚙️" iconBg="#fffaeb" label="Configured" value={String(configured)} />
        <StatCard icon="⚠️" iconBg={failed > 0 ? "#fef2f2" : "#f2f4f7"} label="Failing" value={String(failed)} />
      </StatGrid>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "20px 0 8px", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--ink2)" }}>Environment scope</div>
        <div className="seg" role="tablist" aria-label="Environment scope">
          {ENV_SCOPES.map((s) => (
            <span key={s} role="tab" aria-selected={s === env} tabIndex={0}
              className={s === env ? "on" : undefined}
              onClick={() => setEnv(s)}
              onKeyDown={(e) => e.key === "Enter" && setEnv(s)}>
              {s}
            </span>
          ))}
        </div>
      </div>

      {error && <div className="alert bad" role="alert">{error}</div>}
      {loading ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--ink2)" }}>Loading integrations…</div>
      ) : (
        CATEGORIES.map((cat) => {
          const provs = PROVIDER_META.filter((p) => p.category === cat.id);
          if (provs.length === 0) return null;
          return (
            <section key={cat.id} aria-labelledby={`cat-${cat.id}`} style={{ marginTop: 22 }}>
              <h2 id={`cat-${cat.id}`} style={{ fontSize: 14, fontWeight: 700, color: "var(--ink2)", marginBottom: 12, textTransform: "uppercase", letterSpacing: ".4px" }}>
                {cat.label}
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                {provs.map((p) => {
                  const row = byProvider.get(p.id);
                  const status = row?.status ?? "unconfigured";
                  return (
                    <button
                      key={p.id}
                      className="card"
                      onClick={() => setOpen(p)}
                      aria-label={`Configure ${p.label} for ${env}`}
                      style={{ textAlign: "left", cursor: "pointer", padding: 16, display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--line)" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span aria-hidden style={{ fontSize: 22 }}>{p.icon}</span>
                          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>{p.label}</span>
                        </span>
                        <StatusBadge status={status} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="pill mut np" style={{ textTransform: "uppercase", fontSize: 10.5 }}>{env}</span>
                        {row?.hasSecret && row.secretMasked && (
                          <span style={{ fontSize: 11.5, color: "var(--mut)" }}>secret {row.secretMasked}</span>
                        )}
                        {row?.lastTestedAt && (
                          <span style={{ fontSize: 11, color: "var(--mut)" }}>· tested {new Date(row.lastTestedAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {open && (
        <IntegrationDrawer
          provider={open}
          initialEnv={env}
          onClose={() => setOpen(null)}
          onChanged={() => { void load(); }}
        />
      )}
    </main>
  );
}
