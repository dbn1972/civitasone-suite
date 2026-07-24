import { PageHeader, DataTable, EmptyState, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getCourseDetail } from "../../_data";

type LessonRow = { id: string; title: string; module: string; contentType: string; duration: string };

export default async function Page({ params }: { params: { id: string } }) {
  const { data: course, source } = await getCourseDetail(params.id);

  if (!course) {
    return (
      <>
        <PageHeader title="Course" back="/learning" />
        {source === "error" && <DataSourceBadge source={source} />}
        <EmptyState icon="📚" title="Course not found" message="This course could not be loaded." />
      </>
    );
  }

  const moduleById = new Map(course.modules.map((m) => [m.id, m.title]));
  const lessonRows: LessonRow[] = [...course.lessons]
    .sort((a, b) => a.sequence - b.sequence)
    .map((l) => ({
      id: l.id,
      title: l.title,
      module: moduleById.get((l as unknown as { moduleId?: string }).moduleId ?? "") ?? "—",
      contentType: l.contentType,
      duration: l.durationMins ? `${l.durationMins} min` : "—",
    }));

  return (
    <>
      <PageHeader title={course.title} subtitle={course.description ?? undefined} back="/learning" />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🏷️" iconBg="#eef2ff" label="Code" value={course.code} />
        <StatCard icon="📂" iconBg="#ecfdf5" label="Category" value={course.category} />
        <StatCard icon="⏱️" iconBg="#fffbeb" label="Credit hours" value={`${course.creditHours}`} />
        <StatCard icon="📌" iconBg="#fef2ff" label="Status" value={course.status} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>Prerequisites</h3></div>
        {course.prerequisites.length === 0
          ? <EmptyState icon="✅" title="No prerequisites" message="This course can be taken without completing other courses first." />
          : <ul style={{ padding: "12px 24px" }}>{course.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul>}
      </div>
      <div className="card">
        <div className="card-h"><h3>Modules &amp; lessons</h3></div>
        {lessonRows.length === 0 ? (
          <EmptyState icon="📖" title="No lessons yet" message="Lessons will appear here once the course is authored." />
        ) : (
          <DataTable<LessonRow>
            columns={[
              { key: "title", label: "Lesson" },
              { key: "module", label: "Module" },
              { key: "contentType", label: "Type", cellType: "status" },
              { key: "duration", label: "Duration", align: "right" },
            ]}
            rows={lessonRows}
            pageSize={20}
          />
        )}
      </div>
    </>
  );
}
