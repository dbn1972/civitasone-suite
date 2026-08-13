import Link from "next/link";
import { PageHeader, DataTable, EmptyState, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getCourseDetail } from "../../_data";

type LessonRow = { id: string; title: string; module: string; contentType: string; duration: string };

export default async function Page({ params, searchParams }: {
  params: { id: string };
  searchParams?: { [k: string]: string | string[] | undefined };
}) {
  const { data: course, source } = await getCourseDetail(params.id);
  const employeeId = typeof searchParams?.employeeId === "string" ? searchParams.employeeId : "";

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

  const canEnroll = course.status === "published" && employeeId;

  return (
    <>
      <PageHeader
        title={course.title}
        subtitle={course.description ?? undefined}
        back="/learning"
        actions={
          canEnroll ? (
            <form action={`/api/v1/hrms/learning/courses/${params.id}/enroll`} method="post">
              <input type="hidden" name="employeeId" value={employeeId} />
              <button className="btn primary" type="submit">Enrol Now</button>
            </form>
          ) : course.status === "published" ? (
            <Link href={`/learning/courses/${params.id}?employeeId=`} className="btn">
              Enrol (add ?employeeId=…)
            </Link>
          ) : null
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🏷️" iconBg="var(--panel)" label="Code" value={course.code} />
        <StatCard icon="📂" iconBg="var(--panel)" label="Category" value={course.category} />
        <StatCard icon="⏱️" iconBg="var(--panel)" label="Credit hours" value={`${course.creditHours}`} />
        <StatCard icon="📌" iconBg="var(--panel)" label="Status" value={course.status} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>Prerequisites</h3></div>
        {course.prerequisites.length === 0
          ? <EmptyState icon="✅" title="No prerequisites" message="This course can be taken without completing other courses first." />
          : <ul style={{ padding: "12px 24px" }}>{course.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul>}
      </div>
      <div className="card">
        <div className="card-h">
          <h3>Modules &amp; lessons</h3>
          <span style={{ color: "var(--ink2)", fontSize: "0.875rem" }}>
            {course.modules.length} module{course.modules.length !== 1 ? "s" : ""} · {course.lessons.length} lesson{course.lessons.length !== 1 ? "s" : ""}
          </span>
        </div>
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
