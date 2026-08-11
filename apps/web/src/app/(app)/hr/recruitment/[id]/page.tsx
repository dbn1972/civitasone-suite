import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

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

async function getOpening(id: string): Promise<Opening | null> {
  const r = await fetchJson<unknown, Opening | null>(`/api/v1/hrms/job-openings/${id}`, null, {
    telemetryKey: "recruitment.opening",
    mapResponse: (p) => (p && typeof p === "object" ? (p as Opening) : null),
  });
  return r.data;
}

export default async function JobOpeningDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const opening = await getOpening(params.id);

  if (!opening) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Job Opening" subtitle="Not found" back="/hr/recruitment" />
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "var(--mut)" }}>Job opening not found or you do not have access.</p>
        </div>
      </main>
    );
  }

  const applications = opening.applications ?? [];
  const applied = applications.length;
  const shortlisted = applications.filter((a) => a.stage === "shortlisted").length;
  const selected = applications.filter((a) => ["selected", "offered"].includes(a.stage)).length;

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
        actions={
          <Link href="/hr/recruitment/new" className="btn ghost">+ New Vacancy</Link>
        }
      />

      <StatGrid>
        <StatCard icon="📨" iconBg="#e6f0ff" label="Applied" value={applied} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Shortlisted" value={shortlisted} />
        <StatCard icon="🎉" iconBg="#fef9e7" label="Selected / Offered" value={selected} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Vacancy Details</h3></div>
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Status</span><strong style={{ textTransform: "capitalize" }}>{opening.status}</strong></div>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Published</span><strong>{opening.isPublished === "true" ? "Yes" : "No"}</strong></div>
          {opening.location && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Location</span>{opening.location}</div>}
          {opening.closesAt && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Closing</span>{opening.closesAt}</div>}
          {opening.payRange && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Pay Range</span>{opening.payRange}</div>}
          {opening.qualification && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Qualification</span>{opening.qualification}</div>}
        </div>
      </div>

      <Card title="Applications">
        {applications.length === 0 ? (
          <p style={{ padding: "24px 20px", color: "var(--mut)", textAlign: "center" }}>No applications received yet.</p>
        ) : (
          <DataTable<Application>
            columns={columns}
            rows={applications}
            rowLinkKey="id"
            rowLinkPrefix={`/hr/recruitment/${params.id}/applications/`}
            sortable
            filterable
            filterPlaceholder="Filter by name, stage…"
            pageSize={15}
          />
        )}
      </Card>
    </main>
  );
}
