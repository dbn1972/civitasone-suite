"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, DataTable, LoadErrorState, PageHeader, StatCard, StatGrid, StatusPill } from "@/app/_components/ds";
import { serviceStatusTone, countServiceBuckets } from "@/lib/admin/serviceStatus";
import { formatIndianDateTime } from "@/lib/formatters";
import { mapDiscoveryRegistry, type DiscoveryRegistry as Registry, type DiscoveryService } from "@/lib/admin/discoveryRegistry";

type Row = DiscoveryService & Record<string, unknown>;
type ScanState = "idle" | "scanning" | "throttled" | "failed";

/**
 * GAP-ADMIN-DISCOVERY-02. Three distinct states for the list: failed to load
 * (with retry), nothing registered, rows. "Scan now" re-probes server-side and
 * is throttled there, so holding the button down cannot flood the services.
 */
export function DiscoveryRegistry({ initial, source, errorStatus }: { initial: Registry; source: "api" | "error"; errorStatus?: number }) {
  const t = useTranslations("adminDiscovery");
  const [registry, setRegistry] = useState<Registry>(initial);
  const [loadFailed, setLoadFailed] = useState(source === "error");
  const [scan, setScan] = useState<ScanState>("idle");

  async function scanNow() {
    setScan("scanning");
    try {
      const res = await fetch("/api/proxy/v1/admin/discovery/services?refresh=1", { cache: "no-store" });
      const next = res.ok ? mapDiscoveryRegistry(await res.json().catch(() => undefined)) : null;
      if (!next) { setScan("failed"); return; }
      setRegistry(next);
      setLoadFailed(false);
      setScan(next.throttled ? "throttled" : "idle");
    } catch {
      setScan("failed");
    }
  }

  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} back="/admin" />;
  if (loadFailed && registry.services.length === 0) {
    return (
      <div className="page-main wrap">
        {header}
        <LoadErrorState result={{ status: errorStatus }} area={t("area")} backHref="/admin" />
        <div style={{ marginTop: 12 }}>
          <Button type="button" variant="ghost" size="sm" onClick={() => void scanNow()} loading={scan === "scanning"}>{t("scanNow")}</Button>
        </div>
        {scan === "failed" && <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{t("scanFailed")}</p>}
      </div>
    );
  }

  const rows = registry.services as Row[];
  const c = countServiceBuckets(rows);
  return (
    <div className="page-main wrap">
      {header}
      <StatGrid>
        <StatCard icon="🧭" iconBg="#eef2ff" label={t("statTotal")} value={rows.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statUp")} value={c.up} />
        <StatCard icon="❌" iconBg="#fce7ee" label={t("statDown")} value={c.down} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label={t("statDegraded")} value={c.degraded} />
      </StatGrid>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px", fontSize: 12.5, color: "var(--mut)" }}>
        {registry.checkedAt && <span>{t("checkedAt", { time: formatIndianDateTime(registry.checkedAt) })}</span>}
        <Button type="button" variant="ghost" size="sm" onClick={() => void scanNow()} loading={scan === "scanning"} disabled={scan === "scanning"}>
          {scan === "scanning" ? t("scanning") : t("scanNow")}
        </Button>
        {scan === "throttled" && <span role="status">{t("throttled")}</span>}
        {scan === "failed" && <span role="alert" style={{ color: "#b42318" }}>{t("scanFailed")}</span>}
      </div>
      <Card title={t("registryTitle")}>
        <DataTable<Row>
          columns={[
            { key: "serviceName", label: t("colService") },
            { key: "port", label: t("colPort"), align: "right", render: (r) => (r.port === null ? "—" : String(r.port)) },
            { key: "httpStatus", label: t("colHttp"), align: "right", render: (r) => (r.httpStatus === null ? "—" : String(r.httpStatus)) },
            { key: "status", label: t("colStatus"), render: (r) => (r.status ? <StatusPill status={r.status} variant={serviceStatusTone(r.status)} /> : "—") },
          ]}
          rows={rows} sortable filterable filterPlaceholder={t("search")} pageSize={25}
          emptyIcon="🧭" emptyTitle={t("emptyTitle")} emptyMessage={t("emptyMessage")}
        />
      </Card>
    </div>
  );
}
