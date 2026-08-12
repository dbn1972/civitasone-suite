import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type DashboardStats = {
  totalOpenings: number;
  openVacancies: number;
  publishedVacancies: number;
  internshipsApprenticeships: number;
  applicationsInternal: number;
  applicationsPublic: number;
};

type Opening = {
  id: string;
  jobTitle: string;
  department: string;
  vacancies: number;
  status: string;
  applicationsReceived: number;
  postedDate: string;
  applicationDeadline?: string;
} & Record<string, unknown>;

async function getDashboard(): Promise<DashboardStats> {
  const res = await fetchJson<unknown, DashboardStats>("/api/v1/hrms/recruitment/dashboard", {
    totalOpenings: 0, openVacancies: 0, publishedVacancies: 0,
    internshipsApprenticeships: 0, applicationsInternal: 0, applicationsPublic: 0,
  }, { telemetryKey: "recruitment.dashboard", mapResponse: (p) => p as DashboardStats });
  return res.data;
}

async function getOpenings(): Promise<LoaderResult<Opening[]>> {
  const res = await fetchJson<unknown, Opening[]>("/api/v1/hrms/job-openings?limit=100", [], {
    telemetryKey: "recruitment.openings",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as Record<string, unknown>)?.data;
      return Array.isArray(arr) ? arr as Opening[] : null;
    },
  });
  return res;
}

export default async function RecruitmentPage() {
  const [stats, { data: openings, source: openingSource }] = await Promise.all([getDashboard(), getOpenings()]);
  const totalApps = stats.applicationsInternal + stats.applicationsPublic;

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Recruitment"
        subtitle="Publish vacancies, track applications, and hire — for regular positions, internships, and apprenticeships."
        help="hr"
        actions={
          <>
            <Link href="/hr/recruitment/talent-pool" className="btn ghost">Talent Pool</Link>
            <Link href="/hr/recruitment/new" className="btn primary">+ New Vacancy</Link>
          </>
        }
      />

      <DataSourceBadge source={openingSource} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total Vacancies" value={stats.totalOpenings} />
        <StatCard icon="🟢" iconBg="#ecfdf3" label="Open Now" value={stats.openVacancies} />
        <StatCard icon="🌐" iconBg="#eff6ff" label="Published (Public)" value={stats.publishedVacancies} />
        <StatCard icon="🎓" iconBg="#fffaeb" label="Internships / Apprenticeships" value={stats.internshipsApprenticeships} />
        <StatCard icon="📨" iconBg="#f5f3ff" label="Applications Received" value={totalApps} />
        <StatCard icon="🌍" iconBg="#fef3f2" label="From Public Portal" value={stats.applicationsPublic} />
      </StatGrid>

      <Card title="All vacancies">
        {openings.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No vacancies yet"
            message="Create your first vacancy to start receiving applications from candidates."
            action={<Link href="/hr/recruitment/new" className="btn primary">+ New Vacancy</Link>}
          />
        ) : (
          <DataTable<Opening>
            columns={[
              { key: "jobTitle", label: "Position" },
              { key: "department", label: "Department" },
              { key: "vacancies", label: "Posts", align: "right" },
              { key: "applicationsReceived", label: "Applications", align: "right" },
              { key: "postedDate", label: "Posted" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={openings}
            rowLinkKey="id"
            rowLinkPrefix="/hr/recruitment/"
            sortable
            filterable
            filterPlaceholder="Search vacancies…"
            pageSize={15}
            emptyIcon="📋"
            emptyTitle="No vacancies match"
            emptyMessage="Try a different search."
          />
        )}
      </Card>

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/careers" target="_blank" className="btn ghost">
          🌐 View public careers page
        </Link>
        <Link href="/hr/recruitment/talent-pool" className="btn ghost">
          👥 Browse talent pool
        </Link>
      </div>
    </main>
  );
}
