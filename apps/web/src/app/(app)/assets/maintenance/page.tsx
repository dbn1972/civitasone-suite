import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetMaintenance } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import Link from "next/link";
import { buildMaintenanceRows, countByType } from "./maintenanceRows";
import { getTranslations } from "next-intl/server";
import { AccountingBanner } from "../AccountingBanner";
import { journalKey, rejectionNote } from "../glStatus";

export default async function AssetMaintenancePage() {
  const { data: records, source } = await getAssetMaintenance();
  const errored = source === "error";
  const openJobs = errored ? null : records.filter((r) => r.status === "scheduled" || r.status === "in_progress").length;
  const preventive = errored ? null : countByType(records, "preventive");
  const breakdowns = errored ? null : countByType(records, "breakdown");
  const completed = errored ? null : records.filter((r) => r.status === "completed").length;

  const t = await getTranslations("assetsGl");
  // A completed job whose journal is not (yet) with finance says so in its own column.
  const rows = buildMaintenanceRows(records, (s, error) => {
    const note = s === "failed" ? rejectionNote(error) : null;
    return note ? `${t(journalKey(s))}. ${t(note.key, { reason: note.reason })}` : t(journalKey(s));
  });

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Asset Maintenance"
        subtitle="Preventive schedules and breakdown jobs."
        actions={
          <>
            <Link href="/assets/maintenance/new?type=preventive" className="btn ghost">Schedule</Link>
            <Link href="/assets/maintenance/new?type=breakdown" className="btn primary">+ Log Job</Link>
          </>
        }
      />
      <AccountingBanner areas={["maintenance"]} />
      <StatGrid>
        <StatCard icon="🛠️" iconBg="#fdf0e3" label="Open Jobs" value={openJobs === null ? "—" : openJobs.toLocaleString("en-IN")} />
        <StatCard icon="🔧" iconBg="#eff6ff" label="Preventive" value={preventive === null ? "—" : preventive.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Breakdowns" value={breakdowns === null ? "—" : breakdowns.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed === null ? "—" : completed.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Maintenance jobs</h3>
        </div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "maintenance jobs" })} />
        ) : rows.length === 0 ? (
          <EmptyState icon="🛠️" title="No maintenance jobs" message="Log maintenance jobs to track asset uptime." />
        ) : (
          <DataTable
            columns={[
              { key: "assetCode", label: "Asset code" },
              { key: "assetName", label: "Asset" },
              { key: "maintenanceType", label: "Type" },
              { key: "scheduledDate", label: "Scheduled" },
              { key: "vendor", label: "Technician / Agency" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "journal", label: t("journal") },
            ]}
            rows={rows}
            rowLinkKey="assetId"
            rowLinkPrefix="/assets/"
            identifyingColumnKey="assetName"
            sortable
            filterable
            filterPlaceholder="Filter jobs…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
