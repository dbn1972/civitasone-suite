import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PageHeader, Card, EmptyState } from "../../../../../_components/ds";
import { getProcurementVendorScorecard, getProcurementVendorById } from "../../../../../_data/loaders";

const BAND_COLOR: Record<string, string> = {
  excellent: "var(--good)",
  good:      "var(--good)",
  average:   "var(--warn)",
  poor:      "var(--bad)",
  unrated:   "var(--ink2)",
};

function ScoreBar({ label, score, max = 100 }: { label: string; score: number; max?: number }) {
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
    return (
      <>
        <PageHeader title="Vendor Scorecard" subtitle={vendorName} back={"/procurement/vendors/" + params.id} />
        <EmptyState icon="📊" title="No scorecard yet" message="Performance data will appear after GRN acceptance and order completions." />
      </>
    );
  }

  const subscores = [
    { label: "Delivery",       value: scorecard.deliveryScore ?? 0 },
    { label: "Quality",        value: scorecard.qualityScore ?? 0 },
    { label: "SLA",            value: scorecard.slaScore ?? 0 },
  ];

  const bandColor = BAND_COLOR[scorecard.ratingBand] ?? "var(--ink2)";

  return (
    <>
      <PageHeader
        title="Vendor Scorecard"
        subtitle={vendorName}
        back={"/procurement/vendors/" + params.id}
        actions={
          <>
            <span style={{ background: bandColor, color: "#fff", borderRadius: 4, padding: "2px 10px", fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>
              {scorecard.ratingBand}
            </span>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Overall score", value: String(scorecard.overallRating ?? 0) + "/100", accent: true },
          { label: "Total orders",  value: String(scorecard.totalOrders) },
          { label: "On-time deliveries",    value: String(scorecard.onTimeDeliveries ?? 0) },
          { label: "Late deliveries",       value: String(scorecard.lateDeliveries ?? 0) },
          { label: "Quality rejections",    value: String(scorecard.qualityRejections ?? 0) },
          { label: "SLA breaches",          value: String(scorecard.slaBreaches ?? 0) },
        ].map(({ label, value, accent }) => (
          <div key={label} className="card pad" style={{ textAlign: "center" }}>
            <div style={{ fontSize: accent ? 28 : 22, fontWeight: 700, color: accent ? bandColor : "var(--ink)" }}>{value}</div>
            <div style={{ fontSize: 11, color: "var(--ink2)", marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="Score breakdown" padding>
          {subscores.map((s) => <ScoreBar key={s.label} label={s.label} score={s.value} />)}
        </Card>
        <Card title="Performance radar" padding>
          <RadarChart scores={subscores} />
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
                  <td>{s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
