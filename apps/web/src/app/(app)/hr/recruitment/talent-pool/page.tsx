import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Candidate = {
  id: string;
  applicantName: string;
  email: string | null;
  mobile: string | null;
  qualification: string | null;
  experienceYears: number | null;
  skills: string[] | null;
  source: string;
  stage: string;
  appliedAt: string;
} & Record<string, unknown>;

async function getCandidates(skill?: string, minExp?: string): Promise<LoaderResult<Candidate[]>> {
  let path = "/api/v1/hrms/talent-pool?limit=200";
  if (skill) path += `&skill=${encodeURIComponent(skill)}`;
  if (minExp) path += `&minExp=${encodeURIComponent(minExp)}`;
  const res = await fetchJson<unknown, Candidate[]>(path, [], {
    telemetryKey: "recruitment.talent_pool",
    mapResponse: (p) => {
      const d = (p as Record<string, unknown>)?.data;
      return Array.isArray(d) ? d as Candidate[] : null;
    },
  });
  return res;
}

export default async function TalentPoolPage({
  searchParams,
}: {
  searchParams: { skill?: string; minExp?: string };
}) {
  const { data: candidates, source } = await getCandidates(searchParams.skill, searchParams.minExp);

  const withSkills  = candidates.filter((c) => c.skills && c.skills.length > 0).length;
  const experienced = candidates.filter((c) => (c.experienceYears ?? 0) >= 5).length;
  const activeStage = candidates.filter((c) => !["rejected","not_selected","withdrawn"].includes(c.stage)).length;

  const rows = candidates.map((c) => ({
    ...c,
    skillsDisplay: c.skills?.join(", ") ?? "—",
    expDisplay: c.experienceYears != null ? `${c.experienceYears} yr` : "—",
    appliedDate: new Date(c.appliedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Talent Pool"
        subtitle="All candidates who applied — search by skills, experience, or source to find the right fit for a new vacancy."
        back="/hr/recruitment"
        backLabel="Recruitment"
        help="hr"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="\U0001f465" iconBg="#e6f0ff" label="Total Candidates"   value={candidates.length} />
        <StatCard icon="\U0001f4a1" iconBg="#e6f7f0" label="With Skills"        value={withSkills} />
        <StatCard icon="\U0001f9e0" iconBg="#fff7e6" label="Experienced (5+ yr)" value={experienced} />
        <StatCard icon="\u2705"       iconBg="#f5f5f5" label="Active Stages"     value={activeStage} />
      </StatGrid>

      {/* Filters */}
      <Card padding>
        <form method="GET" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div>
            <label htmlFor="tp-skill" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Skill</label>
            <input id="tp-skill" name="skill" defaultValue={searchParams.skill ?? ""} placeholder="e.g. Excel, Python, Tally" className="input" style={{ minWidth: 180 }} />
          </div>
          <div>
            <label htmlFor="tp-exp" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Min. experience (years)</label>
            <input id="tp-exp" name="minExp" type="number" min="0" defaultValue={searchParams.minExp ?? ""} placeholder="e.g. 2" className="input" style={{ width: 100 }} />
          </div>
          <button type="submit" className="btn primary" style={{ minHeight: 40 }}>Search</button>
          <Link href="/hr/recruitment/talent-pool" className="btn ghost" style={{ minHeight: 40 }}>Clear</Link>
        </form>
      </Card>

      <Card title={`Candidates (${rows.length})`}>
        {rows.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No candidates found"
            message={searchParams.skill || searchParams.minExp
              ? "No one matches that filter. Try broadening your search."
              : "When candidates apply through the public careers page or internally, they appear here."
            }
            action={<Link href="/careers" target="_blank" className="btn ghost">View public careers page</Link>}
          />
        ) : (
          <DataTable
            columns={[
              { key: "applicantName", label: "Name" },
              { key: "email", label: "Email" },
              { key: "qualification", label: "Qualification" },
              { key: "expDisplay", label: "Experience", align: "right" },
              { key: "skillsDisplay", label: "Skills" },
              { key: "source", label: "Source", cellType: "status" },
              { key: "stage", label: "Stage", cellType: "status" },
              { key: "appliedDate", label: "Applied" },
            ]}
            rows={rows}
            sortable
            filterable
        filterPlaceholder="Filter by name, email, skills…"
          emptyIcon="🧑‍💼"
          emptyTitle="No candidates in talent pool"
          emptyMessage="Candidates appear here once they apply to a vacancy. Use the Recruitment module to post a job."
            pageSize={20}
            exportable
          />
        )}
      </Card>
    </main>
  );
}
