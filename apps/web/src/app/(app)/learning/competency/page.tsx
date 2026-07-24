import { PageHeader, DataTable, EmptyState, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getCompetencyProfile, getGapAnalysis } from "../_data";

type Search = { [k: string]: string | string[] | undefined };
type HeldRow = { id: string; competencyId: string; level: string; source: string; evidence: string };
type GapRow = { id: string; competencyId: string; required: number; held: number; gap: number; met: string };

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const employeeId = typeof searchParams?.employeeId === "string" ? searchParams.employeeId : "";
  const roleCode = typeof searchParams?.roleCode === "string" ? searchParams.roleCode : "";

  if (!employeeId) {
    return (
      <>
        <PageHeader title="Competency Profile" subtitle="Held competencies and gaps against a role." back="/learning" />
        <EmptyState icon="🔎" title="Select an employee" message="Append ?employeeId=<uuid>&roleCode=<ROLE> to view a profile and gap analysis." />
      </>
    );
  }

  const [{ data: held, source: s1 }, gap] = await Promise.all([
    getCompetencyProfile(employeeId),
    roleCode ? getGapAnalysis(employeeId, roleCode) : Promise.resolve({ data: null, source: "api" as const }),
  ]);

  const heldRows: HeldRow[] = held.map((h) => ({
    id: h.id, competencyId: h.competencyId, level: `L${h.currentLevel}`,
    source: h.source, evidence: h.evidenceRef ?? "—",
  }));

  const analysis = gap.data;
  const gapRows: GapRow[] = analysis
    ? analysis.rows.map((r) => ({
        id: r.competencyId, competencyId: r.competencyId, required: r.requiredLevel,
        held: r.heldLevel, gap: r.gap, met: r.met ? "met" : "gap",
      }))
    : [];

  return (
    <>
      <PageHeader title="Competency Profile" subtitle="Held competencies and gaps against a role." back="/learning" />
      {s1 === "error" && <DataSourceBadge source={s1} />}
      {analysis && (
        <StatGrid>
          <StatCard icon="🎯" iconBg="#eef2ff" label="Role" value={analysis.roleCode} />
          <StatCard icon="✅" iconBg="#ecfdf5" label="Met" value={`${analysis.metCount} / ${analysis.requiredCount}`} />
          <StatCard icon="⚠️" iconBg="#fffbeb" label="Gaps" value={analysis.gapCount} />
          <StatCard icon="📊" iconBg="#fef2ff" label="Readiness" value={`${analysis.readinessPct}%`} />
        </StatGrid>
      )}
      <div className="card">
        <div className="card-h"><h3>Held competencies</h3></div>
        {heldRows.length === 0 ? (
          <EmptyState icon="🎓" title="No competencies recorded" message="Competencies appear here as they are certified or recorded manually." />
        ) : (
          <DataTable<HeldRow>
            columns={[
              { key: "competencyId", label: "Competency" },
              { key: "level", label: "Level", cellType: "status" },
              { key: "source", label: "Source", cellType: "status" },
              { key: "evidence", label: "Evidence" },
            ]}
            rows={heldRows}
            pageSize={20}
          />
        )}
      </div>
      {roleCode && (
        <div className="card">
          <div className="card-h"><h3>Gap analysis — {roleCode}</h3></div>
          {gapRows.length === 0 ? (
            <EmptyState icon="✅" title="No requirements or all met" message="No gaps found against this role's competency requirements." />
          ) : (
            <DataTable<GapRow>
              columns={[
                { key: "competencyId", label: "Competency" },
                { key: "required", label: "Required", align: "right" },
                { key: "held", label: "Held", align: "right" },
                { key: "gap", label: "Gap", align: "right" },
                { key: "met", label: "Status", cellType: "status" },
              ]}
              rows={gapRows}
              pageSize={20}
            />
          )}
        </div>
      )}
    </>
  );
}
