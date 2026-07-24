import { PageHeader, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getMyLearning } from "../_data";

type Search = { [k: string]: string | string[] | undefined };
type Row = { id: string; course: string; code: string; progress: string; status: string };

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const employeeId = typeof searchParams?.employeeId === "string" ? searchParams.employeeId : "";

  if (!employeeId) {
    return (
      <>
        <PageHeader title="My Learning" subtitle="Your course enrolments, progress and resume point." back="/learning" />
        <EmptyState icon="🔎" title="Select an employee" message="Append ?employeeId=<uuid> to view an employee's learning progress." />
      </>
    );
  }

  const { data: enrolments, source } = await getMyLearning(employeeId);
  const rows: Row[] = enrolments.map((e) => ({
    id: e.id, course: e.courseTitle, code: e.courseCode,
    progress: `${e.progressPct}%`, status: e.status.replace(/_/g, " "),
  }));

  return (
    <>
      <PageHeader title="My Learning" subtitle="Your course enrolments, progress and resume point." back="/learning" />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h"><h3>Enrolments</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📚" title="No enrolments yet" message="Enrol in a published course from the catalogue to start learning." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "course", label: "Course" },
              { key: "code", label: "Code" },
              { key: "progress", label: "Progress", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            sortable
            pageSize={20}
          />
        )}
      </div>
    </>
  );
}
