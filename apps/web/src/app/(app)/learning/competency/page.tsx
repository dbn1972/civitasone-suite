import { PageHeader, DataTable, EmptyState, StatGrid, StatCard, ProgressBar, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { getCompetencyProfile, getGapAnalysis, getCompetencies, getMyProfile } from "../_data";

type Search = { [k: string]: string | string[] | undefined };
type HeldRow = { id: string; competency: string; level: string; source: string; evidence: string };
type GapRow = { id: string; competency: string; required: number; held: number; gap: number; met: string };

// Mirrors services/hrms-service/src/modules/competency/routes.ts privileged set.
const PRIVILEGED_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const roleCode = typeof searchParams?.roleCode === "string" ? searchParams.roleCode : "";
  const queryEmployeeId = typeof searchParams?.employeeId === "string" ? searchParams.employeeId : "";

  const roles = getSessionRoles();
  const isPrivileged = roles.some((r: string) => PRIVILEGED_ROLES.includes(r));

  // GAP-LEARNING-COMPETENCY-02: default the employee to the signed-in user's
  // own linked record (getMyProfile) instead of a typed ?employeeId URL. HR /
  // manager may still override via ?employeeId; a bare employee's override is
  // ignored (the server self-scopes them anyway).
  const me = await getMyProfile();
  const employeeId = isPrivileged && queryEmployeeId ? queryEmployeeId : (me.data?.id ?? "");
  const viewerName = !queryEmployeeId || !isPrivileged ? me.data?.name ?? null : null;

  if (!employeeId) {
    return (
      <>
        <PageHeader title="Competency Profile" subtitle="Held competencies and gaps against a role." back="/learning" />
        <EmptyState icon="👤" title="No employee profile linked" message="Your account is not linked to an employee record, so there is no competency profile to show." />
      </>
    );
  }

  const [{ data: held, source: s1 }, gap, { data: competencyDict }] = await Promise.all([
    getCompetencyProfile(employeeId),
    roleCode ? getGapAnalysis(employeeId, roleCode) : Promise.resolve({ data: null, source: "api" as const }),
    getCompetencies(),
  ]);

  // GAP-LEARNING-COMPETENCY-01: resolve raw competencyId UUIDs to names.
  const nameById = new Map(competencyDict.map((c) => [c.id, c.name || c.code || "Unknown competency"]));
  const resolveName = (id: string) => nameById.get(id) ?? "Unknown competency";

  const heldRows: HeldRow[] = held.map((h) => ({
    id: h.id, competency: resolveName(h.competencyId), level: `L${h.currentLevel}`,
    source: h.source, evidence: h.evidenceRef ?? "—",
  }));

  const analysis = gap.data;
  const gapErrored = roleCode !== "" && gap.source === "error";
  const gapRows: GapRow[] = analysis
    ? analysis.rows.map((r) => ({
        id: r.competencyId, competency: resolveName(r.competencyId), required: r.requiredLevel,
        held: r.heldLevel, gap: r.gap, met: r.met ? "met" : "gap",
      }))
    : [];

  const readinessPct = analysis?.readinessPct ?? null;

  return (
    <>
      <PageHeader
        title="Competency Profile"
        subtitle={viewerName ? `Held competencies and gaps for ${viewerName}.` : "Held competencies and gaps against a role."}
        back="/learning"
      />
      {s1 === "error" && <DataSourceBadge source={s1} />}
      {/* GAP-LEARNING-COMPETENCY-04: when a role is selected but gap analysis
          errored, show '—' stats rather than silently vanishing the grid. */}
      {(analysis || gapErrored) && (
        <StatGrid>
          <StatCard icon="🎯" iconBg="var(--panel)" label="Role" value={analysis?.roleCode ?? roleCode} />
          <StatCard icon="✅" iconBg="var(--panel)" label="Met" value={analysis ? `${analysis.metCount} / ${analysis.requiredCount}` : "—"} />
          <StatCard icon="⚠️" iconBg="var(--panel)" label="Gaps" value={analysis ? analysis.gapCount : "—"} />
          <StatCard icon="📊" iconBg="var(--panel)" label="Readiness" value={readinessPct != null ? `${readinessPct}%` : "—"} />
        </StatGrid>
      )}
      {/* GAP-LEARNING-COMPETENCY-05: a readiness progress bar under the stats. */}
      {analysis && readinessPct != null && (
        <div style={{ margin: "0 0 16px" }}>
          <ProgressBar value={readinessPct} label={`Role readiness ${Math.round(readinessPct)}%`} />
        </div>
      )}
      <div className="card">
        <div className="card-h"><h3>Held competencies</h3></div>
        {s1 === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "held competencies" })} />
        ) : heldRows.length === 0 ? (
          <EmptyState icon="🎓" title="No competencies recorded" message="Competencies appear here as they are certified or recorded manually." />
        ) : (
          <DataTable<HeldRow>
            columns={[
              { key: "competency", label: "Competency" },
              // GAP-LEARNING-COMPETENCY-03: Level and Source are neutral facts,
              // not statuses — render them as plain text, not StatusPills.
              { key: "level", label: "Level" },
              { key: "source", label: "Source" },
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
          {gap.source === "error" ? (
            <RefreshErrorState error={toHumanError("load", { area: "gap analysis" })} />
          ) : analysis && analysis.requiredCount === 0 ? (
            // GAP-LEARNING-COMPETENCY-05: distinguish "no requirements" from "all met".
            <EmptyState icon="📋" title="No requirements defined" message={`No competency requirements are defined for role ${roleCode}.`} />
          ) : gapRows.length === 0 ? (
            <EmptyState icon="✅" title="All requirements met" message="This person meets every competency requirement for the role." />
          ) : (
            <DataTable<GapRow>
              columns={[
                { key: "competency", label: "Competency" },
                { key: "required", label: "Required", align: "right" },
                { key: "held", label: "Held", align: "right" },
                { key: "gap", label: "Gap", align: "right" },
                // Only the met/gap column keeps status semantics.
                { key: "met", label: "Status", cellType: "status" },
              ]}
              rows={gapRows}
              pageSize={20}
            />
          )}
        </div>
      )}
      {!roleCode && (
        <div className="card">
          <div className="card-h"><h3>Gap analysis</h3></div>
          <EmptyState icon="🎯" title="Choose a role to see gaps" message="Append ?roleCode=<ROLE> to compare this profile against a role's competency requirements." />
        </div>
      )}
    </>
  );
}
