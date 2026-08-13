import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";

type Application = {
  id: string;
  applicantName: string;
  email?: string;
  qualification?: string;
  experienceYears?: number;
  source: string;
  stage: string;
  status: string;
  appliedAt: string;
} & Record<string, unknown>;

type Opening = {
  id: string;
  title: string;
  refNo: string;
  departmentId: string;
  vacancies: number;
  status: string;
  vacancyType: string;
  location?: string;
  qualification?: string;
  payRange?: string;
  closesAt?: string;
  isPublished: string;
  applications: Application[];
};

const PIPELINE_STAGES: { key: string; label: string; colour: string }[] = [
  { key: "applied",     label: "Applied",          colour: "var(--line2)" },
  { key: "screened",    label: "Screened",          colour: "var(--line2)" },
  { key: "shortlisted", label: "Shortlisted",       colour: "var(--line2)" },
  { key: "interview",   label: "Interview",         colour: "var(--goodbg)" },
  { key: "offered",     label: "Offered",           colour: "var(--goodbg)" },
  { key: "selected",    label: "Selected / Hired",  colour: "var(--goodbg)" },
  { key: "rejected",    label: "Not Selected",      colour: "var(--badbg)" },
];

async function getOpening(id: string): Promise<LoaderResult<Opening | null>> {
  return fetchJson<unknown, Opening | null>(`/api/v1/hrms/job-openings/${id}`, null, {
    telemetryKey: "recruitment.opening",
    mapResponse: (p) => (p && typeof p === "object" ? (p as Opening) : null),
  });
}

export default async function JobOpeningDetailPage({ params }: { params: { id: string } }) {
  const { data: opening, source } = await getOpening(params.id);

  if (!opening) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Job Opening" subtitle="Not found" back="/hr/recruitment" />
        <DataSourceBadge source={source} />
        <Card title="Error">
          <p style={{ padding: "24px 20px", color: "var(--mut)", textAlign: "center" }}>
            Job opening not found or you do not have access.
          </p>
        </Card>
      </main>
    );
  }

  const applications = opening.applications ?? [];
  const applied = applications.length;
  const shortlisted = applications.filter((a) => a.stage === "shortlisted" || a.stage === "screened").length;
  const interview = applications.filter((a) => a.stage === "interview").length;
  const selected = applications.filter((a) => ["selected", "offered", "hired"].includes(a.stage)).length;

  // Build kanban counts per stage
  const stageCounts = new Map<string, Application[]>();
  for (const stage of PIPELINE_STAGES) stageCounts.set(stage.key, []);
  for (const app of applications) {
    const key = app.stage ?? "applied";
    if (!stageCounts.has(key)) stageCounts.set(key, []);
    stageCounts.get(key)!.push(app);
  }

  const columns: { key: keyof Application & string; label: string; cellType?: "status" }[] = [
    { key: "applicantName", label: "Applicant" },
    { key: "qualification", label: "Qualification" },
    { key: "experienceYears", label: "Exp (yrs)" },
    { key: "source", label: "Source" },
    { key: "stage", label: "Stage", cellType: "status" },
    { key: "appliedAt", label: "Applied" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={opening.title}
        subtitle={`Ref: ${opening.refNo} · ${opening.vacancies} post${opening.vacancies > 1 ? "s" : ""} · ${opening.vacancyType}`}
        back="/hr/recruitment"
        actions={<Link href="/hr/recruitment/new" className="btn ghost">+ New Vacancy</Link>}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📨" iconBg="var(--infobg)" label="Applied" value={applied} />
        <StatCard icon="🔍" iconBg="var(--warnbg)" label="Screened / Shortlisted" value={shortlisted} />
        <StatCard icon="💬" iconBg="var(--line2)" label="Interview" value={interview} />
        <StatCard icon="🎉" iconBg="var(--primary-soft)" label="Selected / Hired" value={selected} />
      </StatGrid>

      {/* ── Application Pipeline (Kanban) ─────────────────────────────── */}
      {applied > 0 && (
        <Card title="Application Pipeline">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 10,
              padding: "8px 0",
            }}
          >
            {PIPELINE_STAGES.map((stage) => {
              const count = (stageCounts.get(stage.key) ?? []).length;
              return (
                <div
                  key={stage.key}
                  style={{
                    background: stage.colour,
                    borderRadius: 10,
                    padding: "12px 14px",
                    textAlign: "center",
                    opacity: count === 0 ? 0.45 : 1,
                  }}
                >
                  <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
                    {count}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.3 }}>{stage.label}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Vacancy Details ───────────────────────────────────────────── */}
      <Card title="Vacancy Details">
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Status</span><strong style={{ textTransform: "capitalize" }}>{opening.status}</strong></div>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Published</span><strong>{opening.isPublished === "true" ? "Yes" : "No"}</strong></div>
          {opening.location && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Location</span>{opening.location}</div>}
          {opening.closesAt && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Closing</span>{opening.closesAt}</div>}
          {opening.payRange && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Pay Range</span>{opening.payRange}</div>}
          {opening.qualification && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Min Qualification</span>{opening.qualification}</div>}
        </div>
      </Card>

      {/* ── Applications List ─────────────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <Card title="All Applications">
          {applications.length === 0 ? (
            <p style={{ padding: "24px 20px", color: "var(--mut)", textAlign: "center" }}>
              No applications received yet. Share the vacancy on the public careers portal to begin accepting applications.
            </p>
          ) : (
            <DataTable<Application>
              columns={columns}
              rows={applications}
              rowLinkKey="id"
              rowLinkPrefix={`/hr/recruitment/${params.id}/applications/`}
              sortable
              filterable
              filterPlaceholder="Filter by name, stage or source…"
              pageSize={15}
              emptyIcon="📨"
              emptyTitle="No matching applications"
              emptyMessage="Try adjusting your filter."
            />
          )}
        </Card>
      </div>
    </main>
  );
}
