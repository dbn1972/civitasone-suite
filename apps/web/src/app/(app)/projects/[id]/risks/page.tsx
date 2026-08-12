import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getProjectRisks } from "../../../../_data/loaders";
import { PageHeader, Card, EmptyState, StatGrid, StatCard } from "@/app/_components/ds";

export default async function ProjectRisksPage({ params }: { params: { id: string } }) {
  const { data: risks, source } = await getProjectRisks(params.id);

  const open     = risks.filter((r) => r.status === "open").length;
  const critical = risks.filter((r) => r.riskScore >= 9).length;
  const mitigated = risks.filter((r) => r.status === "mitigated").length;

  function statusBg(status: string): string {
    if (status === "open")      return "rgba(220,38,38,0.12)";
    if (status === "mitigated") return "rgba(5,150,105,0.12)";
    if (status === "occurred")  return "rgba(220,38,38,0.20)";
    return "rgba(100,116,139,0.10)";
  }
  function statusColor(status: string): string {
    if (status === "open")      return "var(--bad)";
    if (status === "mitigated") return "var(--good)";
    if (status === "occurred")  return "var(--bad)";
    return "var(--ink2)";
  }
  function scoreBg(score: number): string {
    if (score >= 9) return "rgba(220,38,38,0.20)";
    if (score >= 4) return "rgba(245,158,11,0.15)";
    return "rgba(5,150,105,0.12)";
  }
  function scoreColor(score: number): string {
    if (score >= 9) return "var(--bad)";
    if (score >= 4) return "var(--warn)";
    return "var(--good)";
  }

  return (
    <>
      <PageHeader
        title="Risk Register"
        subtitle="Project risks, mitigation plans, and status tracking."
        back={`/projects/${params.id}`}
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Open"      value={open} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Critical"  value={critical} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Mitigated" value={mitigated} />
        <StatCard icon="📋" iconBg="#eef0fe" label="Total"     value={risks.length} />
      </StatGrid>
      <Card title="Risks">
        {risks.length === 0 ? (
          <EmptyState
            icon="✅"
            title="No risks registered"
            message="No risks have been identified for this project."
          />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {["Risk", "Category", "Score", "Probability", "Impact", "Status", "Mitigation"].map((c) => (
                    <th key={c} scope="col">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {risks.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600, maxWidth: 200 }}>{r.title}</td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.85rem" }}>
                      {r.category}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "var(--r)",
                          fontSize: "0.82rem",
                          fontWeight: 700,
                          background: scoreBg(r.riskScore),
                          color: scoreColor(r.riskScore),
                        }}
                      >
                        {r.riskScore}
                      </span>
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.85rem", textTransform: "capitalize" }}>
                      {r.probability}
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.85rem", textTransform: "capitalize" }}>
                      {r.impact}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "var(--r)",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          background: statusBg(r.status),
                          color: statusColor(r.status),
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.82rem", maxWidth: 220 }}>
                      {r.mitigationPlan ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
