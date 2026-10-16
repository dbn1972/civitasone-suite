import { PageHeader, Card, EmptyState, RefreshErrorState } from "../../../../../_components/ds";
import { getProcurementVendorScorecard, getProcurementVendorById } from "../../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

// The backend (scorecard-domain.ts ratingBand) emits A (>= 85), B (>= 70),
// C (>= 50), D (< 50) or "unrated" - GAP-...-SCORECARD-03. The older
// word-bands are kept so a cached/legacy payload still gets a colour.
const BAND_COLOR: Record<string, string> = {
  A: "var(--good)",
  B: "var(--good)",
  C: "var(--warn)",
  D: "var(--bad)",
  excellent: "var(--good)",
  good:      "var(--good)",
  average:   "var(--warn)",
  poor:      "var(--bad)",
  unrated:   "var(--ink2)",
};

function ScoreBar({ label, score, max = 100 }: { label: string; score: number | null; max?: number }) {
  // GAP-...-SCORECARD-05: an unscored dimension is "not measured yet", not a
  // red zero. Show "—" and a neutral grey bar rather than coercing null to 0.
  if (score === null || score === undefined) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 13, color: "var(--ink2)" }}>{label}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)" }}>—</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "var(--line)" }} aria-hidden="true" />
      </div>
    );
  }
  const pct = Math.min(100, Math.round((score / max) * 100));
  const color = pct >= 80 ? "var(--good)" : pct >= 50 ? "var(--warn)" : "var(--bad)";
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: "var(--ink2)" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color }}>{score}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--line)" }}>
        <div style={{ height: "100%", width: pct + "%", borderRadius: 4, background: color, transition: "width 0.3s" }} aria-hidden="true" />
      </div>
    </div>
  );
}

export default async function VendorScorecardPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("procurement.scorecard");
  const [{ data: scorecard, source }, { data: vendor }] = await Promise.all([
    getProcurementVendorScorecard(params.id),
    getProcurementVendorById(params.id),
  ]);

  const vendorName = vendor?.name ?? "Vendor";

  if (!scorecard) {
    // GAP-...-SCORECARD-01: an outage must not read as "this vendor has no
    // history". Only show the empty state on a real empty (source 'api');
    // on a fetch error show a retryable error state instead.
    if (source === "error") {
      return (
        <>
          <PageHeader title="Vendor Scorecard" subtitle={vendorName} back={"/procurement/vendors/" + params.id} />
          <RefreshErrorState
            error={toHumanError("load", { area: "vendor scorecard" })}
            backHref={"/procurement/vendors/" + params.id}
            source={{ area: "vendor scorecard" }}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Vendor Scorecard" subtitle={vendorName} back={"/procurement/vendors/" + params.id} />
        <EmptyState icon="📊" title="No scorecard yet" message="Performance data will appear after GRN acceptance and order completions." />
      </>
    );
  }

  const subscores: { label: string; value: number | null }[] = [
    { label: "Delivery", value: scorecard.deliveryScore ?? null },
    { label: "Quality",  value: scorecard.qualityScore ?? null },
    { label: "SLA",      value: scorecard.slaScore ?? null },
  ];
  // GAP-...-SCORECARD-05: the on-time / late tiles must visibly reconcile with
  // total orders. Orders neither on time nor late are simply not delivered yet.
  const reconcile =
    scorecard.totalOrders != null && scorecard.onTimeDeliveries != null && scorecard.lateDeliveries != null
      ? {
          onTime: scorecard.onTimeDeliveries,
          late: scorecard.lateDeliveries,
          total: scorecard.totalOrders,
          open: scorecard.totalOrders - scorecard.onTimeDeliveries - scorecard.lateDeliveries,
        }
      : null;

  const asOf = scorecard.lastUpdated ? formatIndianDate(scorecard.lastUpdated) : "—";

  const bandColor = BAND_COLOR[scorecard.ratingBand] ?? "var(--ink2)";

  return (
    <>
      <PageHeader
        title="Vendor Scorecard"
        subtitle={`${vendorName} · As of ${asOf}`}
        back={"/procurement/vendors/" + params.id}
        actions={
          <span style={{ background: bandColor, color: "var(--panel)", borderRadius: 4, padding: "2px 10px", fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>
            {scorecard.ratingBand}
          </span>
        }
      />

      {/* GAP-...-SCORECARD-03: the band legend explains the thresholds so the
          /100 score is interpretable, and states plainly that this performance
          score (out of 100) is distinct from the buyer rating (out of 5) shown
          on the list/profile — two honest, separately-sourced measures rather
          than one re-scaled into the other. */}
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        {t("legend")}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Overall score", value: scorecard.overallRating !== null && scorecard.overallRating !== undefined ? `${scorecard.overallRating}/100` : "—", accent: true },
          { label: "Total orders",  value: scorecard.totalOrders ?? "—" },
          { label: "On-time deliveries",    value: scorecard.onTimeDeliveries ?? "—" },
          { label: "Late deliveries",       value: scorecard.lateDeliveries ?? "—" },
          { label: "Quality rejections",    value: scorecard.qualityRejections ?? "—" },
          { label: "SLA breaches",          value: scorecard.slaBreaches ?? "—" },
        ].map(({ label, value, accent }) => (
          <div key={label} className="card pad" style={{ textAlign: "center" }}>
            <div style={{ fontSize: accent ? 28 : 22, fontWeight: 700, color: accent ? bandColor : "var(--ink)" }}>{String(value)}</div>
            <div style={{ fontSize: 11, color: "var(--ink2)", marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {reconcile ? (
        <p className="muted" role="note" style={{ fontSize: 12, margin: "0 0 16px" }}>
          {reconcile.open > 0
            ? t("reconcileOpen", { onTime: reconcile.onTime, late: reconcile.late, total: reconcile.total, open: reconcile.open })
            : reconcile.open < 0
              ? t("reconcileMismatch", { onTime: reconcile.onTime, late: reconcile.late, total: reconcile.total })
              : t("reconcile", { onTime: reconcile.onTime, late: reconcile.late, total: reconcile.total })}
        </p>
      ) : null}

      {/* GAP-...-SCORECARD-04: the three-axis radar was a triangle duplicating
          these three bars, so it is dropped and the breakdown takes the full
          width (the bars already carry every value as text). */}
      <Card title="Score breakdown" padding>
        {subscores.map((s) => <ScoreBar key={s.label} label={s.label} score={s.value} />)}
      </Card>
    </>
  );
}
