import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, StatusPill } from "../../../_components/ds";
import { getJobOpenings } from "../../../_data/loaders";
import type { JobOpeningSummary } from "@civitasone/types";

export default async function RecruitmentPage() {
  const { data: openings, source } = await getJobOpenings();

  const total = openings.length;
  const open = openings.filter((o) => o.status === "open").length;
  const closed = openings.filter((o) => o.status === "closed").length;
  const totalApplications = openings.reduce((sum, o) => sum + o.applicationsReceived, 0);

  const columns: { key: keyof JobOpeningSummary & string; label: string; align?: "left" | "right"; render?: (row: JobOpeningSummary) => React.ReactNode }[] = [
    { key: "jobTitle", label: "Job Title" },
    { key: "department", label: "Department" },
    { key: "vacancies", label: "Vacancies", align: "right" },
    { key: "applicationsReceived", label: "Applications", align: "right" },
    { key: "applicationDeadline", label: "Deadline", render: (r) => r.applicationDeadline ?? "—" },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusPill status={r.status} label={r.status.replace("_", " ")} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Recruitment"
        subtitle="Active job openings and application pipeline."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total" value={total} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Open" value={open} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Closed" value={closed} />
        <StatCard icon="👥" iconBg="#e6f0ff" label="Applications" value={totalApplications.toLocaleString("en-IN")} />
      </StatGrid>
      <Card title="Job Openings">
        <DataTable<JobOpeningSummary>
          columns={columns}
          rows={openings}
        />
      </Card>
    </>
  );
}
