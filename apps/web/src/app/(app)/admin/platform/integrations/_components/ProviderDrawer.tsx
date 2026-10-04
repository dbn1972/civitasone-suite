"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Drawer, Field, Input, Select, Tabs, TabPanel } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import {
  EDITIONS,
  PLATFORM_API,
  fieldLabel,
  isEmptyList,
  pollUntil,
  type PlatformProvider,
  type ProviderStatus,
} from "@/lib/admin/platformIntegrations";
import { ProviderStatusPill } from "../../../integrations/platform/_components/badges";

type TenantOption = { tenantId: string; name: string; edition: string };
type TabId = "overview" | "fields" | "availability";
const TABS: TabId[] = ["overview", "fields", "availability"];
const TENANT_PAGE = 100;

async function readProvider(key: string): Promise<PlatformProvider | null> {
  try {
    const res = await fetch(`${PLATFORM_API}/providers/${key}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { data: PlatformProvider }).data;
  } catch {
    return null;
  }
}

/** "" -> null (no endpoint); a valid https URL -> itself; anything else -> undefined (invalid). */
export function parseEndpoint(raw: string): string | null | undefined {
  const v = raw.trim();
  if (v === "") return null;
  try {
    return new URL(v).protocol === "https:" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function ProviderDrawer({ provider, onClose, onChanged }: { provider: PlatformProvider; onClose: () => void; onChanged: () => Promise<void> }) {
  const t = useTranslations("platformIntegrations");
  const locale = useLocale();
  const formError = useFormError("integration provider");
  const [tab, setTab] = useState<TabId>("overview");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const [status, setStatus] = useState<ProviderStatus>(provider.status);
  const [sandboxUrl, setSandboxUrl] = useState(provider.endpoints.sandbox ?? "");
  const [prodUrl, setProdUrl] = useState(provider.endpoints.production ?? "");

  const [mode, setMode] = useState<"all" | "restricted">(provider.availability.mode);
  const [editions, setEditions] = useState<string[]>(provider.availability.editions);
  const [tenantIds, setTenantIds] = useState<string[]>(provider.availability.tenantIds);
  const [tenants, setTenants] = useState<TenantOption[] | null>(null);
  const [tenantsFailed, setTenantsFailed] = useState(false);
  const [tenantsTotal, setTenantsTotal] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (tab !== "availability" || tenants !== null || tenantsFailed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/admin/tenants?page=1&limit=${TENANT_PAGE}`, { cache: "no-store" });
        if (!res.ok) throw new Error("load");
        const body = (await res.json()) as { items?: TenantOption[]; total?: number };
        if (!cancelled) { setTenants(body.items ?? []); setTenantsTotal(body.total ?? (body.items?.length ?? 0)); }
      } catch {
        if (!cancelled) setTenantsFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, tenants, tenantsFailed]);

  const shownTenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tenants ?? []).filter((x) => q === "" || x.name.toLowerCase().includes(q));
  }, [tenants, search]);

  const tabLabels = TABS.map((x) => t(`platform.drawer.tabs.${x}`));

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setNotice(null); setLocalError(null); formError.clear();
    try {
      const res = await fetch(`${PLATFORM_API}/providers/${provider.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: provider.version, ...body }),
      });
      if (!res.ok) { await formError.fromResponse(res, "save"); return; }
      const before = provider.version;
      const { settled } = await pollUntil(() => readProvider(provider.key), (p) => p.version > before);
      setNotice(settled ? t("platform.drawer.saved") : t("platform.drawer.stillApplying"));
      await onChanged();
    } catch {
      formError.fromException("save");
    } finally {
      setBusy(false);
    }
  }

  function saveOverview() {
    const sandbox = parseEndpoint(sandboxUrl);
    const production = parseEndpoint(prodUrl);
    if (sandbox === undefined || production === undefined) { setLocalError(t("platform.drawer.endpointInvalid")); return; }
    const body: Record<string, unknown> = {};
    if (status !== provider.status) body.status = status;
    if (sandbox !== provider.endpoints.sandbox || production !== provider.endpoints.production) body.endpoints = { sandbox, production };
    if (isEmptyList(Object.keys(body))) return;
    void patch(body);
  }

  function saveAvailability() {
    if (mode === "restricted" && isEmptyList(editions) && isEmptyList(tenantIds)) { setLocalError(t("platform.availability.needOne")); return; }
    void patch({ availability: { mode, tenantIds: mode === "restricted" ? tenantIds : [], editions: mode === "restricted" ? editions : [] } });
  }

  const toggle = (list: string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const overviewDirty = status !== provider.status
    || sandboxUrl.trim() !== (provider.endpoints.sandbox ?? "")
    || prodUrl.trim() !== (provider.endpoints.production ?? "");

  return (
    <Drawer title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{provider.name} <ProviderStatusPill status={provider.status} /></span>} onClose={onClose} busy={busy}
      footer={<Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.close")}</Button>}>
      <Tabs tabs={tabLabels} active={t(`platform.drawer.tabs.${tab}`)} onChange={(label) => { setLocalError(null); setNotice(null); formError.clear(); setTab(TABS[tabLabels.indexOf(label)] ?? "overview"); }} ariaLabel={t("platform.drawer.tabsLabel")} idPrefix="pi-provider-tab" />
      {notice && <div className="alert" role="status">{notice}</div>}
      {(formError.message || localError) && <div className="alert bad" role="alert"><p>{localError ?? formError.message}</p></div>}

      <TabPanel idPrefix="pi-provider-tab" active={t(`platform.drawer.tabs.${tab}`)}>
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {provider.vendor && <div><strong>{t("platform.drawer.vendor")}:</strong> {provider.vendor}</div>}
            <div><strong>{t("platform.drawer.description")}:</strong> {provider.description}</div>
            <div>
              <strong>{t("platform.drawer.capabilities")}:</strong>{" "}
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>{provider.capabilities.map((c) => <span key={c} className="chip">{c}</span>)}</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>{t("platform.drawer.usage", { sandbox: provider.usage.sandbox, production: provider.usage.production })}</div>

            <Field label={t("platform.drawer.statusLabel")} disabled={busy}>
              <Select value={status} onChange={(e) => setStatus(e.target.value as ProviderStatus)}>
                {(["available", "beta", "disabled"] as const).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </Select>
            </Field>
            <p className="muted" style={{ fontSize: 12, margin: "-8px 0 0" }}>{t("platform.drawer.statusHelp")}</p>

            <h3 style={{ fontSize: 14, margin: "6px 0 0" }}>{t("platform.drawer.endpointsTitle")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: "-8px 0 0" }}>{t("platform.drawer.endpointsNote")}</p>
            <Field label={t("platform.drawer.sandboxEndpoint")} disabled={busy}>
              <Input type="url" value={sandboxUrl} onChange={(e) => setSandboxUrl(e.target.value)} maxLength={2048} autoComplete="off" />
            </Field>
            <Field label={t("platform.drawer.productionEndpoint")} disabled={busy}>
              <Input type="url" value={prodUrl} onChange={(e) => setProdUrl(e.target.value)} maxLength={2048} autoComplete="off" />
            </Field>
            <div><Button variant="primary" onClick={saveOverview} loading={busy} disabled={busy || !overviewDirty}>{busy ? t("common.saving") : t("platform.drawer.saveOverview")}</Button></div>
          </div>
        )}

        {tab === "fields" && (
          <div style={{ overflowX: "auto" }}>
            <p className="muted" style={{ fontSize: 12 }}>{t("platform.fieldsTable.hint")}</p>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">{t("platform.fieldsTable.label")}</th>
                  <th scope="col">{t("platform.fieldsTable.type")}</th>
                  <th scope="col">{t("platform.fieldsTable.required")}</th>
                  <th scope="col">{t("platform.fieldsTable.secret")}</th>
                  <th scope="col">{t("platform.fieldsTable.environments")}</th>
                  <th scope="col">{t("platform.fieldsTable.visibleWhen")}</th>
                </tr>
              </thead>
              <tbody>
                {provider.fields.map((f) => (
                  <tr key={f.key}>
                    <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>{fieldLabel(f, locale)}<div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{f.key}</div></th>
                    <td>{t(`fieldType.${f.type}`)}</td>
                    <td>{f.required ? t("platform.fieldsTable.yes") : t("platform.fieldsTable.no")}</td>
                    <td>{f.secret ? t("platform.fieldsTable.yes") : t("platform.fieldsTable.no")}</td>
                    <td>{f.environments.map((e) => t(`env.${e}`)).join(", ")}</td>
                    <td>{f.showWhen ? `${f.showWhen.field} = ${f.showWhen.equals}` : t("platform.fieldsTable.always")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "availability" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }} disabled={busy}>
              <legend className="sr-only">{t("platform.table.availability")}</legend>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="radio" name="pi-mode" checked={mode === "all"} onChange={() => setMode("all")} />
                <span>{t("platform.availability.allOption")}</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="radio" name="pi-mode" checked={mode === "restricted"} onChange={() => setMode("restricted")} />
                <span>{t("platform.availability.restrictedOption")}</span>
              </label>
            </fieldset>

            {mode === "restricted" && (
              <>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
                  <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("platform.availability.editionsLabel")}</legend>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {EDITIONS.map((e) => (
                      <label key={e} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={editions.includes(e)} onChange={() => setEditions((cur) => toggle(cur, e))} />
                        <span>{t(`editions.${e}`)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
                  <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("platform.availability.tenantsLabel")}</legend>
                  {tenantsFailed ? (
                    <p className="muted">{t("platform.availability.tenantsLoadFailed")}</p>
                  ) : tenants === null ? (
                    <p className="muted" role="status">{t("common.loading")}</p>
                  ) : (
                    <>
                      <Input type="search" aria-label={t("platform.availability.searchTenants")} placeholder={t("platform.availability.searchTenants")} value={search} onChange={(e) => setSearch(e.target.value)} />
                      {tenantsTotal > TENANT_PAGE && <p className="muted" style={{ fontSize: 12 }}>{t("platform.availability.tenantsTruncated", { count: TENANT_PAGE })}</p>}
                      <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                        {isEmptyList(shownTenants) ? (
                          <p className="muted">{t("platform.availability.noTenantMatch")}</p>
                        ) : shownTenants.map((x) => (
                          <label key={x.tenantId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input type="checkbox" checked={tenantIds.includes(x.tenantId)} onChange={() => setTenantIds((cur) => toggle(cur, x.tenantId))} />
                            <span>{x.name}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </fieldset>
              </>
            )}
            <div><Button variant="primary" onClick={saveAvailability} loading={busy} disabled={busy}>{busy ? t("common.saving") : t("platform.availability.save")}</Button></div>
          </div>
        )}
      </TabPanel>
    </Drawer>
  );
}
