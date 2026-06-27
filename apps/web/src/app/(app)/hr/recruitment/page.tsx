import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { getJobOpenings } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

type Row = {
  id: string;
  jobTitle: string;
  department: string;
  vacancies: number;
  applicationsReceived: number;
  deadline: string;
  status: string;
} & Record<string, unknown>;

export default async function RecruitmentPage() {
  const { data: openings, source } = await getJobOpenings();

  const total = openings.length;
  const open = openings.filter((o) => o.status === "open").length;
  const closed = openings.filter((o) => o.status === "closed").length;
  const totalApplications = openings.reduce((sum, o) => sum + o.applicationsReceived, 0);

  const rows: Row[] = openings.map((o) => ({
    id: o.id,
    jobTitle: o.jobTitle,
    department: o.department,
    vacancies: o.vacancies,
    applicationsReceived: o.applicationsReceived,
    deadline: o.applicationDeadline ? formatIndianDate(o.applicationDeadline) : "—",
    status: o.status.replace("_", " "),
  }));

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "jobTitle", label: "Job Title" },
    { key: "department", label: "Department" },
    { key: "vacancies", label: "Vacancies", align: "right" },
    { key: "applicationsReceived", label: "Applications", align: "right" },
    { key: "deadline", label: "Deadline" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Recruitment"
        subtitle="Active job openings and application pipeline."
        actions={
          <Link
            href="/hr/recruitment/new"
            className="btn primary"
          >
            + New Opening
          </Link>
        }
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total" value={total} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Open" value={open} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Closed" value={closed} />
        <StatCard icon="👥" iconBg="#e6f0ff" label="Applications" value={totalApplications.toLocaleString("en-IN")} />
      </StatGrid>
      <Card title="Job Openings">
        <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by title, department or status…"
          pageSize={15}
        />
      </Card>
    </main>
  );
}
