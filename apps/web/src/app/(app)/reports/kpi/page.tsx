import { getKPIs } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { KpiClient, type KpiRow } from "./KpiClient";

export default async function KPITrackerPage() {
  const { data: kpis, source } = await getKPIs();
  const errored = source === "error";

  const onTrack = kpis.filter((k) => k.status === "on_track").length;
  const atRisk = kpis.filter((k) => k.status === "at_risk").length;
  const offTrack = kpis.filter((k) => k.status === "off_track").length;
  // GAP-REPORTS-KPI-03: the old "Outcome-linked" card counted KPIs whose unit
  // was "%"/"pct" and showed a static "→ budget" delta — a heuristic dressed up
  // as a budget linkage that no field backs. Replaced with an honest
  // "Percentage KPIs" count and no fabricated delta.
  const percentageKpis = kpis.filter((k) => k.unit === "%" || k.unit === "pct").length;

  function statusLabel(s: string) {
    if (s === "on_track") return "Met";
    if (s === "at_risk") return "Near";
    if (s === "off_track") return "Below";
    return s;
  }

  // GAP-REPORTS-KPI-05: the old mapping folded any unknown status into
  // "rejected" (red). Map each known status to a meaningful pill and send an
  // unknown status to a neutral "draft" pill, never a misleading red.
  function statusPill(s: string) {
    if (s === "on_track") return "active";
    if (s === "at_risk") return "pending";
    if (s === "off_track") return "rejected";
    return "draft";
  }

  const rows: KpiRow[] = kpis.map((kpi) => ({
    id: kpi.id,
    kpiName: kpi.kpiName,
    module: kpi.module,
    currentValue: kpi.currentValue,
    targetValue: kpi.targetValue,
    achievementPct: kpi.achievementPct,
    unit: kpi.unit,
    period: kpi.period,
    statusLabel: statusLabel(kpi.status),
    statusPill: statusPill(kpi.status),
    rawStatus: kpi.status,
  }));

  return (
    <div className="wrap">
      <PageHeader
        title="KPI Monitoring"
        subtitle="Department KPIs &amp; outcome indicators with targets."
      />

      {/* GAP-REPORTS-KPI-02: on a fetch error the stats read "—", not a
          fabricated 0 / 0% above the retry card. GAP-REPORTS-KPI-05: the
          "Set Targets" action was removed from the header — it linked to the
          generic report-job form (/reports/list/new?reportType=kpi-target),
          which does NOT set a KPI target (no KPI-targets command exists in
          report-service). Advertising it implied targets could be set here;
          see GAP-REPORTS-LIST-NEW-01. */}
      <StatGrid>
        <StatCard icon="🎯" tone="info" label="KPIs Tracked" value={errored ? null : kpis.length} />
        <StatCard
          icon="✅"
          tone="good"
          label="On / Above Target"
          value={errored ? null : onTrack}
          delta={errored ? undefined : `${kpis.length ? Math.round((onTrack / kpis.length) * 100) : 0}%`}
          up={onTrack > 0}
        />
        <StatCard icon="⚠️" tone="warn" label="Below Target" value={errored ? null : offTrack + atRisk} />
        <StatCard icon="🔗" tone="info" label="Percentage KPIs" value={errored ? null : percentageKpis} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>KPI monitoring</h3>
        </div>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "KPI data" })} backHref="/reports" />
        ) : kpis.length === 0 ? (
          <EmptyState icon="🎯" title="No KPI data available" message="KPIs will appear once the service has processed data." />
        ) : (
          <KpiClient rows={rows} />
        )}
      </div>
    </div>
  );
}
