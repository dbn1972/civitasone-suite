"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Button, EmptyState, ErrorState, PageHeader, SkeletonCard, StatCard, StatGrid, TabPanel, Tabs,
} from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import {
  CATEGORIES,
  TENANT_API,
  byCategory,
  isEmptyList,
  newIdempotencyKey,
  pollUntil,
  recordFor,
  type IntegrationCategory,
  type PolicySettings,
  type SwitchRequest,
  type TenantCatalogueProvider,
  type TenantRecord,
} from "@/lib/admin/platformIntegrations";
import { EnvBadge, HealthCard, ProviderStatusPill } from "./badges";
import { IntegrationConfigDrawer } from "./IntegrationConfigDrawer";
import { PolicyPanel } from "./PolicyPanel";
import { SwitchApprovals } from "./SwitchApprovals";

type Loaded = { catalogue: TenantCatalogueProvider[]; records: TenantRecord[]; pending: SwitchRequest[]; settings: PolicySettings };

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${TENANT_API}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { data: T }).data;
  } catch {
    return null;
  }
}

/** Best-effort id -> name directory so approvals never show a raw id. Needs tenant_admin; module admins fall back to a generic label. */
async function loadNames(): Promise<Record<string, string>> {
  try {
    const res = await fetch("/api/proxy/v1/admin/users?limit=200", { cache: "no-store" });
    if (!res.ok) return {};
    const body = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown; email?: unknown }> };
    const out: Record<string, string> = {};
    for (const u of body.data ?? []) {
      const label = typeof u.name === "string" && u.name.trim() !== "" ? u.name : typeof u.email === "string" ? u.email : "";
      if (typeof u.id === "string" && label) out[u.id] = label;
    }
    return out;
  } catch {
    return {};
  }
}

export function TenantIntegrationsClient({ actorId, canEditPolicy }: { actorId: string | null; canEditPolicy: boolean }) {
  const t = useTranslations("platformIntegrations");
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<IntegrationCategory>("esign");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [quick, setQuick] = useState<Record<string, { busy: boolean; text?: string }>>({});
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const [catalogue, records, pending, settings] = await Promise.all([
      getJson<TenantCatalogueProvider[]>("/catalogue"),
      getJson<TenantRecord[]>("/records"),
      getJson<SwitchRequest[]>("/production-switches?status=pending"),
      getJson<PolicySettings>("/settings"),
    ]);
    if (catalogue && records && pending && settings) {
      setData({ catalogue, records, pending, settings });
      setFailed(false);
    } else {
      setFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    void loadNames().then(setNames);
  }, [load]);

  const providerNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of data?.catalogue ?? []) m[p.key] = p.name;
    for (const r of data?.records ?? []) m[r.providerKey] ??= r.providerName;
    return m;
  }, [data]);

  /** Providers shown in a category: the available catalogue plus any configured provider the platform has since withdrawn. */
  const providersIn = useCallback((c: IntegrationCategory): TenantCatalogueProvider[] => {
    if (!data) return [];
    const listed = byCategory(data.catalogue, c);
    const known = new Set(listed.map((p) => p.key));
    const orphans: TenantCatalogueProvider[] = byCategory(data.records, c)
      .filter((r) => !known.has(r.providerKey))
      .map((r) => ({
        key: r.providerKey, category: r.category, name: r.providerName, vendor: "", description: "",
        capabilities: [], fields: [], endpoints: { sandbox: null, production: null }, status: "disabled" as const, configured: true,
      }));
    return [...listed, ...orphans];
  }, [data]);

  async function quickTest(key: string) {
    setQuick((q) => ({ ...q, [key]: { busy: true } }));
    let text: string;
    try {
      const res = await fetch(`${TENANT_API}/records/${key}/test`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": newIdempotencyKey() }, body: "{}" });
      if (res.status === 501) text = t("tenant.drawer.notYetAvailable");
      else if (!res.ok) text = t("tenant.drawer.testError");
      else {
        const out = ((await res.json()) as { data: { ok: boolean; message: string } }).data;
        text = out.ok ? t("tenant.drawer.testOk", { message: out.message }) : t("tenant.drawer.testFail", { message: out.message });
        await pollUntil(() => getJson<TenantRecord>(`/records/${key}`), (r) => r.health.status !== "untested", { tries: 5, delayMs: 400 });
        await load();
      }
    } catch {
      text = t("tenant.drawer.testError");
    }
    setQuick((q) => ({ ...q, [key]: { busy: false, text } }));
  }

  const tabLabels = CATEGORIES.map((c) => t(`categories.${c}`));
  const open = data && openKey ? providersIn(category).concat(data.catalogue).find((p) => p.key === openKey) : undefined;
  const openRecord = data && openKey ? recordFor(data.records, openKey) : undefined;
  const approvalOn = data?.settings.requireProductionApproval ?? true;

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      available: data.catalogue.length,
      configured: data.records.length,
      production: data.records.filter((r) => r.environment === "production").length,
      pending: data.pending.length,
    };
  }, [data]);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("tenant.title")} subtitle={t("tenant.subtitle")} back="/admin" />

      {loading && !data ? (
        <div aria-busy="true" aria-label={t("common.loading")} className="grid g-3" style={{ marginTop: 22 }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : failed && !data ? (
        <ErrorState error={toHumanError("load", { area: "integrations" })} onRetry={() => { void load(); }} backHref="/admin" />
      ) : data ? (
        <>
          {failed && (
            <div className="alert bad" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span>{toHumanError("load", { area: "integrations" }).what}</span>
              <Button size="sm" onClick={() => { void load(); }}>{t("common.retry")}</Button>
            </div>
          )}
          <div className="alert" role="note">{t("tenant.sandboxNotice")}</div>
          <p className="muted" style={{ fontSize: 13 }}>
            {t("tenant.otherIntegrations")} <Link href="/admin/integrations">{t("tenant.otherIntegrationsLink")}</Link>
          </p>

          {stats && (
            <StatGrid>
              <StatCard icon="🧩" iconBg="#eef2ff" label={t("tenant.stats.available")} value={String(stats.available)} />
              <StatCard icon="⚙️" iconBg="#fffaeb" label={t("tenant.stats.configured")} value={String(stats.configured)} />
              <StatCard icon="🚀" iconBg="#ecfdf3" label={t("tenant.stats.production")} value={String(stats.production)} />
              <StatCard icon="⏳" iconBg="#f2f4f7" label={t("tenant.stats.pending")} value={String(stats.pending)} />
            </StatGrid>
          )}

          <PolicyPanel settings={data.settings} names={names} actorId={actorId} canEditPolicy={canEditPolicy} onChanged={load} />

          <SwitchApprovals requests={data.pending} providerNames={providerNames} names={names} actorId={actorId} onChanged={load} />

          <div style={{ margin: "24px 0 8px" }}>
            <Tabs tabs={tabLabels} active={t(`categories.${category}`)} onChange={(label) => setCategory(CATEGORIES[tabLabels.indexOf(label)] ?? "esign")} ariaLabel={t("tenant.tabsLabel")} idPrefix="pi-tenant-cat" />
          </div>
          <TabPanel idPrefix="pi-tenant-cat" active={t(`categories.${category}`)}>
            <p className="muted" style={{ fontSize: 13 }}>{t(`categoryHelp.${category}`)}</p>
            {isEmptyList(providersIn(category)) ? (
              <EmptyState title={t("tenant.list.emptyTitle")} message={t("tenant.list.emptyMessage", { category: t(`categoryNoun.${category}`) })} />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                {providersIn(category).map((p) => {
                  const rec = recordFor(data.records, p.key);
                  const q = quick[p.key];
                  return (
                    <article key={p.key} className="card" aria-label={p.name} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                        <div>
                          <h3 style={{ margin: 0, fontSize: 15 }}>{p.name}</h3>
                          {p.vendor && <div className="muted" style={{ fontSize: 12 }}>{p.vendor}</div>}
                        </div>
                        <ProviderStatusPill status={p.status} />
                      </div>
                      {p.description && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{p.description}</p>}
                      {rec ? (
                        <>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <EnvBadge env={rec.environment} />
                            {!rec.enabled && <span className="pill mut">{t("tenant.list.integrationOff")}</span>}
                            {rec.pendingSwitch && <span className="pill warn">{t("tenant.list.pendingBadge")}</span>}
                          </div>
                          <HealthCard health={rec.health} />
                        </>
                      ) : (
                        <span className="muted" style={{ fontSize: 13 }}>{t("tenant.list.notConfigured")}</span>
                      )}
                      {p.status === "beta" && <span className="muted" style={{ fontSize: 12 }}>{t("tenant.list.betaNote")}</span>}
                      {p.status === "disabled" && <span className="muted" style={{ fontSize: 12 }}>{t("tenant.list.providerDisabled")}</span>}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
                        <Button size="sm" variant="primary" onClick={() => setOpenKey(p.key)}>{rec ? t("tenant.list.manage") : t("tenant.list.configure")}</Button>
                        {rec && p.status !== "disabled" && (
                          <Button size="sm" variant="secondary" onClick={() => { void quickTest(p.key); }} loading={q?.busy === true} disabled={q?.busy === true}>
                            {q?.busy ? t("tenant.list.testing") : t("tenant.list.testConnection")}
                          </Button>
                        )}
                      </div>
                      <div role="status" aria-live="polite" style={{ fontSize: 12 }}>{q?.text ?? ""}</div>
                    </article>
                  );
                })}
              </div>
            )}
          </TabPanel>

          {open && (
            <IntegrationConfigDrawer
              key={open.key}
              provider={open}
              record={openRecord}
              approvalRequired={approvalOn}
              onClose={() => setOpenKey(null)}
              onChanged={load}
            />
          )}

        </>
      ) : null}
    </div>
  );
}
