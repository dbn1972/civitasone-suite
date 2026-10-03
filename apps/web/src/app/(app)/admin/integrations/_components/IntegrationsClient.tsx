"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ErrorState, PageHeader, SkeletonCard, StatGrid, StatCard, TabPanel, Tabs } from "@/app/_components/ds";
import {
  CATEGORIES,
  ENV_SCOPES,
  PROVIDER_META,
  type EnvScope,
  type IntegrationRow,
  type ProviderMeta,
} from "./providers";
import { IntegrationDrawer, StatusBadge } from "./IntegrationDrawer";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";

const API = "/api/proxy/v1/admin/integrations";

/**
 * GAP-ADMIN-INTEGRATIONS-05: "Configured" = a secret is stored or the row is past
 * "unconfigured". `enabled` alone is NOT configuration: an enabled-but-empty
 * provider used to count, disagreeing with its own "Not configured" card pill.
 */
export function countConfigured(rows: Pick<IntegrationRow, "hasSecret" | "status">[]): number {
  return rows.filter((r) => r.hasSecret || r.status !== "unconfigured").length;
}

export function IntegrationsClient() {
  const [env, setEnv] = useState<EnvScope>("prod");
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  // GAP-ADMIN-INTEGRATIONS-02: has any load ever succeeded? Rows are only trustworthy after one has.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ProviderMeta | null>(null);
  const formError = useFormError("integrations");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API, { signal });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        setError(resolved.message);
        return;
      }
      const body = await res.json();
      setRows((body.data ?? []) as IntegrationRow[]);
      setHasLoaded(true);
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
    // avoids re-creating load (and re-running its effect) every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
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

  // While the list is loading or its last load failed, the counts are unknown
  // (null renders as a dash) -- never a real-looking zero.
  const countsKnown = !loading && error === null;
  const connected = forEnv.filter((r) => r.status === "connected").length;
  const failed = forEnv.filter((r) => r.status === "failed").length;
  const configured = countConfigured(forEnv);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Integrations"
        subtitle="External endpoints for AI, messaging, email, payments and files. Secrets are encrypted at rest and never displayed."
        back="/admin"
      />

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eef2ff" label="Providers" value={String(PROVIDER_META.length)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Connected" value={countsKnown ? String(connected) : null} />
        <StatCard icon="⚙️" iconBg="#fffaeb" label="Configured" value={countsKnown ? String(configured) : null} />
        <StatCard icon="⚠️" iconBg={countsKnown && failed > 0 ? "#fef2f2" : "#f2f4f7"} label="Failing" value={countsKnown ? String(failed) : null} />
      </StatGrid>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "20px 0 8px", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--ink2)" }}>Environment scope</div>
        <Tabs tabs={[...ENV_SCOPES]} active={env} onChange={(t) => setEnv(t as EnvScope)} ariaLabel="Environment scope" idPrefix="int-page-env" />
      </div>

      {error && hasLoaded && (
        <div className="alert bad" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>{error} The statuses below may be out of date.</span>
          <Button size="sm" onClick={() => { void load(); }}>Retry</Button>
        </div>
      )}
      <TabPanel idPrefix="int-page-env" active={env}>
      {loading && !hasLoaded ? (
        <div aria-busy="true" aria-label="Loading integrations" className="grid g-3" style={{ marginTop: 22 }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : error && !hasLoaded ? (
        // The first load failed: every provider would read "Not configured",
        // which is false and invites re-entering credentials over a live
        // secret. Show a retry instead of the grid.
        <ErrorState error={toHumanError("load", { area: "integrations" })} onRetry={() => { void load(); }} backHref="/admin" />
      ) : (
        <>
        {CATEGORIES.map((cat) => {
          const provs = PROVIDER_META.filter((p) => p.category === cat.id);
          if (provs.length === 0) return null; // ux-001-ok: grouping a static PROVIDER_META catalog by category, not a loader result
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
        })}
        </>
      )}
      </TabPanel>

      {open && (
        <IntegrationDrawer
          provider={open}
          initialEnv={env}
          onClose={() => setOpen(null)}
          onChanged={() => { void load(); }}
        />
      )}
    </div>
  );
}
