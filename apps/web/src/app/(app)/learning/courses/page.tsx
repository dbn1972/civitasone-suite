import Link from "next/link";
import { PageHeader, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getCourses } from "../_data";

type Search = { [k: string]: string | string[] | undefined };
type Row = { id: string; code: string; title: string; category: string; creditHours: string; status: string };

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const q = typeof searchParams?.q === "string" ? searchParams.q : undefined;
  const { data: courses, source } = await getCourses(q);

  const rows: Row[] = courses.map((c) => ({
    id: c.id, code: c.code, title: c.title, category: c.category,
    creditHours: `${c.creditHours} hrs`, status: c.status,
  }));

  return (
    <>
      <PageHeader
        title="Course Catalogue"
        subtitle="Browse all published courses and enrol to start learning."
        back="/learning"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h">
          <h3>All courses</h3>
          <span style={{ color: "var(--ink2)", fontSize: "0.875rem" }}>{rows.length} course{rows.length !== 1 ? "s" : ""}</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="📚" title="No courses published yet" message="Published courses will appear here for enrolment." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "code", label: "Code" },
              { key: "title", label: "Title" },
              { key: "category", label: "Category" },
              { key: "creditHours", label: "Credit hours", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/learning/courses/"
            sortable
            filterable
            filterPlaceholder="Search courses…"
            pageSize={20}
          />
        )}
      </div>
    </>
  );
}
