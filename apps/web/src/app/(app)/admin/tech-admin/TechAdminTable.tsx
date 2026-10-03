"use client";
import { useRouter } from "next/navigation";
import { Button, Card, DataTable, StatGrid, StatCard, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { serviceStatusTone } from "@/lib/admin/serviceStatus";
import { formatIndianDateTime } from "@/lib/formatters";
import { formatMemory, formatUptime, summariseServices } from "./techAdminModel";
type Row = Record<string, unknown>;

/**
 * GAP-ADMIN-TECH-ADMIN-04: the tiles live here, next to the table, and are
 * computed from the hook's `rows`, so a cached fallback can never show 0/0/0/0
 * above a table of saved rows. Parent remounts this on every server render
 * (key = fetchedAt) because useSeededResource does not re-apply new initialData.
 */
export function TechAdminTable({ services, source = "api", fetchedAt }: { services: Row[]; source?: "api" | "error"; fetchedAt?: string }) {
  const router = useRouter();
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.tech-admin", services, source, (d) => d.length === 0);
  const summary = summariseServices(rows, provenance === "error-no-data");
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for the rows below. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <StatGrid>
        <StatCard icon="⚙️" iconBg="#eef2ff" label="Services" value={summary.total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Running" value={summary.running} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Stopped or errored" value={summary.down} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={summary.degraded} />
        <StatCard icon="❔" iconBg="#f2f4f7" label="Unknown status" value={summary.unknown} />
      </StatGrid>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px", fontSize: 12.5, color: "var(--mut)" }}>
        {fetchedAt && <span>Checked {formatIndianDateTime(fetchedAt)}</span>}
        <Button type="button" variant="ghost" size="sm" onClick={() => router.refresh()}>Refresh</Button>
      </div>
      <Card title="Service Status">
      <DataTable<Row>
        columns={[
          { key: "serviceName", label: "Service" },
          { key: "port", label: "Port", align: "right" },
          { key: "dbConnections", label: "DB Conns", align: "right" },
          { key: "memory", label: "Memory", align: "right", render: (r) => formatMemory(r.memory) },
          { key: "uptime", label: "Uptime", align: "right", render: (r) => formatUptime(r.uptime) },
          { key: "status", label: "Status", render: (r) => (r.status == null || r.status === "" ? "—" : <StatusPill status={String(r.status)} variant={serviceStatusTone(r.status)} />) },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search services…" pageSize={20} exportable exportFilename="tech-admin" emptyIcon="⚙️" emptyTitle="No services" emptyMessage="Service health data not available."
      />
      </Card>
    </>
  );
}
