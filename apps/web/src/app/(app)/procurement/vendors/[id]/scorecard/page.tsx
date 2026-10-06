import { PageHeader, Card, EmptyState, RefreshErrorState } from "../../../../../_components/ds";
import { getProcurementVendorScorecard, getProcurementVendorById } from "../../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";

const BAND_COLOR: Record<string, string> = {
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

function RadarChart({ scores }: { scores: { label: string; value: number }[] }) {
  const N = scores.length;
  if (N < 3) return null;
  const cx = 120; const cy = 120; const R = 90;
  const step = (2 * Math.PI) / N;

  const toPoint = (i: number, r: number) => ({
    x: cx + r * Math.sin(i * step),
    y: cy - r * Math.cos(i * step),
  });

  const axisLines = scores.map((_, i) => {
    const p = toPoint(i, R);
    return "M " + cx + "," + cy + " L " + p.x.toFixed(1) + "," + p.y.toFixed(1);
  }).join(" ");

  const polyPath = scores.map((s, i) => {
    const p = toPoint(i, R * Math.min(100, s.value) / 100);
    return (i === 0 ? "M" : "L") + " " + p.x.toFixed(1) + "," + p.y.toFixed(1);
  }).join(" ") + " Z";

  return (
    <svg viewBox="0 0 240 240" aria-label="Performance radar chart" style={{ maxWidth: 240, display: "block", margin: "0 auto" }}>
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map((frac) => {
        const pts = scores.map((_, i) => {
          const p = toPoint(i, R * frac);
          return p.x.toFixed(1) + "," + p.y.toFixed(1);
        }).join(" ");
        return <polygon key={frac} points={pts} fill="none" stroke="var(--line)" strokeWidth="1" />;
      })}
      {/* Axis lines */}
      <path d={axisLines} stroke="var(--line)" strokeWidth="1" fill="none" />
      {/* Data polygon */}
      <path d={polyPath} fill="var(--good)" fillOpacity="0.25" stroke="var(--good)" strokeWidth="2" />
      {/* Labels */}
      {scores.map((s, i) => {
        const p = toPoint(i, R + 16);
        return <text key={i} x={p.x.toFixed(1)} y={p.y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="var(--ink2)">{s.label}</text>;
      })}
    </svg>
  );
}

export default async function VendorScorecardPage({ params }: { params: { id: string } }) {
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
  // Radar only plots dimensions that are actually scored (05).
  const radarScores = subscores
    .filter((s): s is { label: string; value: number } => s.value !== null)
    .map((s) => ({ label: s.label, value: s.value }));

  const asOf = scorecard.lastUpdated ? formatIndianDate(scorecard.lastUpdated) : "—";

  const bandColor = BAND_COLOR[scorecard.ratingBand] ?? "var(--ink2)";

  return (
    <>
      <PageHeader
        title="Vendor Scorecard"
        subtitle={`${vendorName} · As of ${asOf}`}
        back={"/procurement/vendors/" + params.id}
        actions={
          <span style={{ background: bandColor, color: "#fff", borderRadius: 4, padding: "2px 10px", fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>
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
        Performance score is out of 100 (bands: Excellent ≥ 90, Good 75–89,
        Average 50–74, Poor &lt; 50). This is separate from the buyer rating
        (out of 5) shown on the vendor list and profile.
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

      {/* GAP-...-SCORECARD-02: responsive — stack on phones, two columns on
          desktop (was a fixed "1fr 1fr" with no breakpoint). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))", gap: 16 }}>
        <Card title="Score breakdown" padding>
          {subscores.map((s) => <ScoreBar key={s.label} label={s.label} score={s.value} />)}
        </Card>
        <Card title="Performance radar" padding>
          <RadarChart scores={radarScores} />
          <table className="sr-only" aria-label="Performance radar data table">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {subscores.map((s) => (
                <tr key={s.label}>
                  <td>{s.label}</td>
                  <td>{s.value === null ? "—" : s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
