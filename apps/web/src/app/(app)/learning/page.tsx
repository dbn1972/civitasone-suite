import Link from "next/link";
import { PageHeader, DataTable, EmptyState, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getCourses, getLmsDashboard } from "./_data";

type Row = { id: string; code: string; title: string; category: string; creditHours: string; status: string };

export default async function Page() {
  const [{ data: courses, source }, { data: stats }] = await Promise.all([
    getCourses(),
    getLmsDashboard(),
  ]);

  const rows: Row[] = courses.map((c) => ({
    id: c.id, code: c.code, title: c.title, category: c.category,
    creditHours: `${c.creditHours} hrs`, status: c.status,
  }));

  return (
    <>
      <PageHeader
        title="Learning & Development"
        subtitle="Course catalogue, training calendar, my learning progress and competencies."
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <Link href="/learning/my-learning">
          <StatCard icon="📚" iconBg="var(--panel)" label="Enrolled" value={stats.enrolled} />
        </Link>
        <Link href="/learning/my-learning">
          <StatCard icon="▶️" iconBg="var(--panel)" label="In Progress" value={stats.in_progress} />
        </Link>
        <Link href="/learning/my-learning">
          <StatCard icon="✅" iconBg="var(--panel)" label="Completed" value={stats.completed} />
        </Link>
        <Link href="/learning/my-learning">
          <StatCard icon="⚠️" iconBg="var(--panel)" label="Overdue" value={stats.overdue} />
        </Link>
      </StatGrid>
      <StatGrid>
        <Link href="/learning/calendar"><StatCard icon="📅" iconBg="var(--panel)" label="Training Calendar" value="Sessions & nominations" /></Link>
        <Link href="/learning/competency"><StatCard icon="🎯" iconBg="var(--panel)" label="Competencies" value="Profile & gaps" /></Link>
        <Link href="/learning/assessments"><StatCard icon="📝" iconBg="var(--panel)" label="Assessments" value="Take & verify" /></Link>
        <Link href="/learning/training-plans"><StatCard icon="📋" iconBg="var(--panel)" label="Training Plans" value="Annual plans" /></Link>
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Course catalogue</h3>
          <Link href="/learning/courses" className="btn">Browse all</Link>
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
            filterPlaceholder="Search the catalogue…"
            pageSize={10}
          />
        )}
      </div>
    </>
  );
}
