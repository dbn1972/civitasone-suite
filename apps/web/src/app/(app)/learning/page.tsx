import Link from "next/link";
import { PageHeader, DataTable, EmptyState, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { combineResourceState } from "@/app/_data/useResource";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { getCourses, getLmsDashboard, getMyProfile } from "./_data";

type Row = { id: string; code: string; title: string; category: string; creditHours: string; status: string };

// Mirrors services/hrms-service/src/modules/learning/routes.ts HR_ROLES.
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function Page() {
  // GAP-LEARNING-HOME-01: the stat cards read as the viewer's PERSONAL
  // progress but previously called getLmsDashboard() with no employeeId, which
  // the backend aggregates tenant-wide. Pass the signed-in user's own employee
  // id so an employee sees their own counts (matching My Learning). HR could
  // still request tenant totals, but these cards are the personal view.
  const me = await getMyProfile();
  const myId = me.data?.id ?? null;

  const [coursesResult, dashboardResult] = await Promise.all([
    getCourses(),
    getLmsDashboard(myId ?? undefined),
  ]);
  const { data: courses } = coursesResult;
  const { data: stats } = dashboardResult;

  const roles = getSessionRoles();
  const isHr = roles.some((r: string) => HR_ROLES.includes(r));

  const resource = combineResourceState([coursesResult, dashboardResult], courses);
  if (resource.status === "error") {
    return (
      <>
        <PageHeader
          title="Learning & Development"
          subtitle="Course catalogue, training calendar, my learning progress and competencies."
        />
        <RefreshErrorState error={toHumanError("load", { area: "learning dashboard" })} />
      </>
    );
  }

  // GAP-LEARNING-HOME-02: each stat card links to My Learning scoped to the
  // viewer (and filtered by status) so the primary path from home to the
  // user's own progress no longer dead-ends on "Select an employee".
  const myLearningHref = (status?: string) => {
    const params = new URLSearchParams();
    if (myId) params.set("employeeId", myId);
    if (status) params.set("status", status);
    const qs = params.toString();
    return qs ? `/learning/my-learning?${qs}` : "/learning/my-learning";
  };

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
      <StatGrid>
        <StatCard href={myLearningHref()} icon="📚" iconBg="var(--panel)" label="Enrolled" value={stats.enrolled} />
        <StatCard href={myLearningHref("in_progress")} icon="▶️" iconBg="var(--panel)" label="In Progress" value={stats.in_progress} />
        <StatCard href={myLearningHref("completed")} icon="✅" iconBg="var(--panel)" label="Completed" value={stats.completed} />
        <StatCard href={myLearningHref("overdue")} icon="⚠️" iconBg="var(--panel)" label="Overdue" value={stats.overdue} />
      </StatGrid>
      {/* GAP-LEARNING-HOME-05: navigation tiles use Card (title + description)
          rather than sentences stuffed into StatCard's big value slot. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" style={{ marginBottom: 16 }}>
        <Link href="/learning/calendar" className="tile-link"><Card title="📅 Training Calendar"><div className="pad">Scheduled programmes and your nomination status.</div></Card></Link>
        <Link href="/learning/competency" className="tile-link"><Card title="🎯 Competencies"><div className="pad">Your competency profile and gaps against a role.</div></Card></Link>
        <Link href="/learning/assessments" className="tile-link"><Card title="📝 Assessments"><div className="pad">Attempt published assessments and verify certificates.</div></Card></Link>
        <Link href="/learning/training-plans" className="tile-link"><Card title="📋 Training Plans"><div className="pad">Annual training plans and their items.</div></Card></Link>
      </div>
      <div className="card">
        <div className="card-h">
          {/* GAP-LEARNING-HOME-03: honest copy. The catalogue can include drafts
              for HR; a non-HR learner sees the same list the backend returns.
              Call it the "Course catalogue" rather than claiming "published". */}
          <h3>Course catalogue</h3>
          <Link href="/learning/courses" className="btn">Browse all</Link>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="📚" title="No courses yet" message={isHr ? "Courses you create will appear here." : "Courses will appear here for enrolment."} />
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
            identifyingColumnKey="title"
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
