"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, PageHeader, SkeletonCard, StatCard, StatGrid, TabPanel, Tabs } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import {
  CATEGORIES,
  PLATFORM_API,
  availabilityParts,
  byCategory,
  isEmptyList,
  type IntegrationCategory,
  type PlatformProvider,
} from "@/lib/admin/platformIntegrations";
import { ProviderStatusPill } from "../../../integrations/platform/_components/badges";
import { ProviderDrawer } from "./ProviderDrawer";

async function loadProviders(): Promise<PlatformProvider[] | null> {
  try {
    const res = await fetch(`${PLATFORM_API}/providers`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { data: PlatformProvider[] }).data;
  } catch {
    return null;
  }
}

/** Super-admin catalogue of supported eSign / DSC / bank API / PFMS providers. */
export function PlatformIntegrationsClient() {
  const t = useTranslations("platformIntegrations");
  const [rows, setRows] = useState<PlatformProvider[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState<IntegrationCategory>("esign");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const data = await loadProviders();
    if (data) { setRows(data); setFailed(false); } else { setFailed(true); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      providers: all.length,
      available: all.filter((p) => p.status === "available").length,
      beta: all.filter((p) => p.status === "beta").length,
      disabled: all.filter((p) => p.status === "disabled").length,
    };
  }, [rows]);

  const tabLabels = CATEGORIES.map((c) => t(`categories.${c}`));
  const active = t(`categories.${category}`);
  const visible = rows ? byCategory(rows, category) : [];
  const open = rows?.find((p) => p.key === openKey);

  function describeAvailability(p: PlatformProvider): string {
    const a = availabilityParts(p.availability);
    if (a.all) return t("platform.availability.all");
    const parts: string[] = [];
    if (a.tenants > 0) parts.push(t("platform.availability.tenants", { count: a.tenants }));
    if (!isEmptyList(a.editions)) parts.push(t("platform.availability.editions", { list: a.editions.map((e) => t(`editions.${e as "govt_dept" | "psu" | "small_office"}`)).join(", ") }));
    return isEmptyList(parts) ? t("platform.availability.nobody") : parts.join(" · ");
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("platform.title")} subtitle={t("platform.subtitle")} back="/admin" />

      {loading && !rows ? (
        <div aria-busy="true" aria-label={t("common.loading")} className="grid g-3" style={{ marginTop: 22 }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : failed && !rows ? (
        <ErrorState error={toHumanError("load", { area: "integration providers" })} onRetry={() => { void load(); }} backHref="/admin" />
      ) : rows ? (
        <>
          {failed && (
            <div className="alert bad" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span>{toHumanError("load", { area: "integration providers" }).what}</span>
              <Button size="sm" onClick={() => { void load(); }}>{t("common.retry")}</Button>
            </div>
          )}
          <StatGrid>
            <StatCard icon="🧩" iconBg="#eef2ff" label={t("platform.stats.providers")} value={String(counts.providers)} />
            <StatCard icon="✅" iconBg="#ecfdf3" label={t("platform.stats.available")} value={String(counts.available)} />
            <StatCard icon="🧪" iconBg="#fffaeb" label={t("platform.stats.beta")} value={String(counts.beta)} />
            <StatCard icon="⛔" iconBg="#f2f4f7" label={t("platform.stats.disabled")} value={String(counts.disabled)} />
          </StatGrid>

          <div style={{ margin: "24px 0 8px" }}>
            <Tabs tabs={tabLabels} active={active} onChange={(label) => setCategory(CATEGORIES[tabLabels.indexOf(label)] ?? "esign")} ariaLabel={t("platform.tabsLabel")} idPrefix="pi-platform-cat" />
          </div>
          <TabPanel idPrefix="pi-platform-cat" active={active}>
            <p className="muted" style={{ fontSize: 13 }}>{t(`categoryHelp.${category}`)}</p>
            {isEmptyList(visible) ? (
              <EmptyState title={t("platform.empty.title")} message={t("platform.empty.message")} />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="tbl">
                  <caption className="sr-only">{active}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("platform.table.provider")}</th>
                      <th scope="col">{t("platform.table.status")}</th>
                      <th scope="col">{t("platform.table.availability")}</th>
                      <th scope="col">{t("platform.table.usage")}</th>
                      <th scope="col"><span className="sr-only">{t("platform.table.action")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr key={p.key}>
                        <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>
                          {p.name}
                          {p.vendor && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{p.vendor}</div>}
                        </th>
                        <td><ProviderStatusPill status={p.status} /></td>
                        <td>{describeAvailability(p)}</td>
                        <td>{p.usage.sandbox} / {p.usage.production}</td>
                        <td><Button size="sm" variant="secondary" onClick={() => setOpenKey(p.key)} aria-label={t("platform.manage", { name: p.name })}>{t("platform.table.action")}</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabPanel>

          {open && <ProviderDrawer key={open.key} provider={open} onClose={() => setOpenKey(null)} onChanged={load} />}
        </>
      ) : null}
    </div>
  );
}
