import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatCreditHours } from "@/lib/formatters";
import { getCourseDetail, getCourses, getMyLearning } from "../../_data";
import { getMyProfile } from "@/app/_data/loaders";
import { EnrolButton } from "./EnrolButton";

type LessonRow = { id: string; title: string; module: string; contentType: string; duration: string };

export default async function Page({ params }: { params: { id: string } }) {
  const { data: course, source } = await getCourseDetail(params.id);

  // GAP-LEARNING-COURSES-DETAIL-04: distinguish a real load error (retry) from
  // a genuine 404 (not-found). Only a null course from a healthy API is a 404.
  if (source === "error") {
    return (
      <>
        <PageHeader title="Course" back="/learning" />
        <RefreshErrorState error={toHumanError("load", { area: "course" })} backHref="/learning" />
      </>
    );
  }
  if (!course) {
    notFound();
  }

  // Resolve own employee id (self-service) + catalogue (for prereq titles) +
  // my enrolments (completed-course pre-check and current enrol state).
  const [{ data: profile }, { data: catalogue }, { data: myEnrolments }] = await Promise.all([
    getMyProfile(),
    getCourses(),
    profileEnrolments(),
  ]);

  const employeeId = profile?.id ?? "";
  const titleById = new Map(catalogue.map((c) => [c.id, c.title] as const));
  const completedCourseIds = new Set(
    myEnrolments.filter((e) => e.status === "completed").map((e) => e.courseId),
  );
  const myEnrolmentForThis = myEnrolments.find((e) => e.courseId === course.id);

  const moduleById = new Map(course.modules.map((m) => [m.id, m.title]));
  const isEnrolled = Boolean(myEnrolmentForThis);
  const lessonRows: LessonRow[] = [...course.lessons]
    .sort((a, b) => a.sequence - b.sequence)
    .map((l) => ({
      id: l.id,
      title: l.title,
      module: moduleById.get(l.moduleId) ?? "—",
      contentType: l.contentType,
      duration: l.durationMins ? `${l.durationMins} min` : "—",
    }));

  // Prerequisite names + which are still unmet (DETAIL-04 + DETAIL-05 pre-check).
  const prereqs = course.prerequisites.map((pid) => ({
    id: pid,
    title: titleById.get(pid) ?? null,
    met: completedCourseIds.has(pid),
  }));
  const unmetPrereqTitles = prereqs.filter((p) => !p.met).map((p) => p.title ?? "Unknown course");

  const published = course.status === "published";

  return (
    <>
      <PageHeader
        title={course.title}
        subtitle={course.description ?? undefined}
        back="/learning"
        actions={
          published && !isEnrolled ? (
            employeeId ? (
              <EnrolButton
                courseId={course.id}
                employeeId={employeeId}
                unmetPrereqs={unmetPrereqTitles}
              />
            ) : (
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>
                No employee record linked to your account.
              </span>
            )
          ) : isEnrolled ? (
            <Link href="/learning/my-learning" className="btn">Go to My Learning</Link>
          ) : null
        }
      />
      <StatGrid>
        <StatCard icon="🏷️" iconBg="var(--panel)" label="Code" value={course.code} />
        <StatCard icon="📂" iconBg="var(--panel)" label="Category" value={course.category} />
        <StatCard icon="⏱️" iconBg="var(--panel)" label="Credit hours" value={formatCreditHours(course.creditHours)} />
        <StatCard icon="📌" iconBg="var(--panel)" label="Status" value={course.status} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>Prerequisites</h3></div>
        {prereqs.length === 0 ? (
          <EmptyState icon="✅" title="No prerequisites" message="This course can be taken without completing other courses first." />
        ) : (
          <ul style={{ padding: "12px 24px" }}>
            {prereqs.map((p) => (
              <li key={p.id}>
                {p.title ? (
                  <Link href={`/learning/courses/${p.id}`}>{p.title}</Link>
                ) : (
                  <span>Course (unavailable)</span>
                )}
                {p.met ? " — completed" : " — not completed"}
              </li>
            ))}
          </ul>
        )}
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
            {...(isEnrolled
              ? { rowLinkKey: "id" as const, rowLinkPrefix: `/learning/courses/${course.id}/lessons/` }
              : {})}
            pageSize={20}
          />
        )}
        {!isEnrolled && lessonRows.length > 0 && (
          <p style={{ padding: "0 24px 16px", fontSize: 13, color: "var(--ink2)" }}>
            Enrol to open lessons and track your progress.
          </p>
        )}
      </div>
    </>
  );
}

// Resolve the caller's own enrolments without the caller needing to supply an
// id — the backend self-scopes a bare employee to their own record, so an
// empty employeeId returns the caller's own rows (GAP-LEARNING-MY-LEARNING-01).
async function profileEnrolments() {
  return getMyLearning();
}
