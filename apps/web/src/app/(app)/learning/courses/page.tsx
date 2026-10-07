import { PageHeader, DataTable, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatCreditHours } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getCourses, getMyLearning } from "../_data";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type Search = { [k: string]: string | string[] | undefined };
type Row = { id: string; code: string; title: string; category: string; creditHours: string; myStatus: string; status: string };

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const q = typeof searchParams?.q === "string" ? searchParams.q : undefined;
  const statusParam = typeof searchParams?.status === "string" ? searchParams.status : undefined;
  const roles = getSessionRoles();
  const isHr = roles.some((r) => HR_ROLES.includes(r));
  // Only HR may filter by status; everyone else gets published only (enforced
  // server-side too — GAP-LEARNING-COURSES-01).
  const effectiveStatus = isHr ? statusParam : undefined;

  // Fetch catalogue + my enrolments in parallel (COURSES-04 "My status").
  const [{ data: courses, source }, { data: myEnrolments }] = await Promise.all([
    getCourses(q, effectiveStatus),
    getMyLearning(),
  ]);

  const myStatusByCourse = new Map(myEnrolments.map((e) => [e.courseId, e.status] as const));
  const myStatusLabel = (courseId: string): string => {
    const s = myStatusByCourse.get(courseId);
    return s ?? "—";
  };

  const rows: Row[] = courses.map((c) => ({
    id: c.id, code: c.code, title: c.title, category: c.category,
    creditHours: formatCreditHours(c.creditHours), myStatus: myStatusLabel(c.id), status: c.status,
  }));

  const truncated = rows.length === 100;

  return (
    <>
      <PageHeader
        title="Course Catalogue"
        subtitle="Browse all published courses and enrol to start learning."
        back="/learning"
      />
      <div className="card">
        <div className="card-h">
          <h3>All courses</h3>
          <span style={{ color: "var(--ink2)", fontSize: "0.875rem" }}>{rows.length} course{rows.length !== 1 ? "s" : ""}</span>
        </div>
        {/* GAP-LEARNING-COURSES-02: server-side search (GET form), so results
            are filtered by the backend, not only within the first 100 rows. */}
        <form method="get" style={{ display: "flex", gap: 8, padding: "12px 24px", flexWrap: "wrap" }} role="search">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search courses…"
            aria-label="Search courses"
            style={{ minHeight: 40, flex: "1 1 220px", maxWidth: 360 }}
          />
          {isHr && (
            <select name="status" defaultValue={statusParam ?? ""} aria-label="Filter by status" style={{ minHeight: 40 }}>
              <option value="">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="retired">Retired</option>
            </select>
          )}
          <button type="submit" className="btn primary" style={{ minHeight: 40 }}>Search</button>
        </form>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "course catalogue" })} backHref="/learning" />
        ) : rows.length === 0 ? (
          <EmptyState icon="📚" title="No courses found" message="No courses match your search. Try a different term." />
        ) : (
          <>
            {truncated && (
              <p style={{ padding: "0 24px", fontSize: 13, color: "var(--amber, #d97706)" }}>
                Showing the first 100 results. Refine your search to narrow them down.
              </p>
            )}
            <DataTable<Row>
              columns={[
                { key: "code", label: "Code" },
                { key: "title", label: "Title" },
                { key: "category", label: "Category" },
                { key: "creditHours", label: "Credit hours", align: "right" },
                { key: "myStatus", label: "My status", cellType: "status" },
                ...(isHr ? [{ key: "status" as const, label: "Status", cellType: "status" as const }] : []),
              ]}
              rows={rows}
              rowLinkKey="id"
              rowLinkPrefix="/learning/courses/"
              identifyingColumnKey="title"
              sortable
              pageSize={20}
            />
          </>
        )}
      </div>
    </>
  );
}
