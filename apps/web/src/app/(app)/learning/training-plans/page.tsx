import Link from "next/link";
import { PageHeader, DataTable, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTrainingPlans, getDepartments } from "../_data";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const PAGE_SIZE = 20;

type Search = { [k: string]: string | string[] | undefined };
type Row = { id: string; title: string; planYear: string; scope: string; status: string };

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const roles = getSessionRoles();
  const isHr = roles.some((r) => HR_ROLES.includes(r));

  const yearParam = typeof searchParams?.year === "string" ? Number(searchParams.year) : undefined;
  const year = yearParam && Number.isInteger(yearParam) ? yearParam : undefined;
  const pageParam = typeof searchParams?.page === "string" ? Number(searchParams.page) : 1;
  const page = pageParam && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [{ data: plansPage, source }, { data: departments }] = await Promise.all([
    getTrainingPlans({ year, limit: PAGE_SIZE, offset }),
    getDepartments(),
  ]);

  const deptById = new Map(departments.map((d) => [d.id, d.name] as const));

  const scopeFor = (p: { roleCode?: string | null; departmentId?: string | null }): string => {
    const parts: string[] = [];
    if (p.departmentId) {
      const name = deptById.get(p.departmentId);
      parts.push(`Dept: ${name ?? "unknown"}`);
    }
    if (p.roleCode) parts.push(`Role: ${p.roleCode}`);
    return parts.length ? parts.join(" · ") : "All staff";
  };

  const rows: Row[] = plansPage.data.map((p) => ({
    id: p.id,
    title: p.title,
    // GAP-LEARNING-TRAINING-PLANS-04: Indian government training plans run on
    // the April–March fiscal year; label accordingly.
    planYear: `FY ${fiscalYearLabel(p.planYear)}`,
    scope: scopeFor(p),
    status: p.status,
  }));

  const total = plansPage.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Training Plans"
        subtitle="Annual training plans assigned by department or role."
        back="/learning"
        actions={isHr ? <Link href="/learning/training-plans/new" className="btn primary">+ New plan</Link> : undefined}
      />
      <div className="card">
        <div className="card-h">
          <h3>Annual plans</h3>
          <span style={{ color: "var(--ink2)", fontSize: "0.875rem" }}>
            Showing {rows.length} of {total} plan{total !== 1 ? "s" : ""}
          </span>
        </div>
        {/* GAP-LEARNING-TRAINING-PLANS-05: server-side year filter */}
        <form method="get" style={{ display: "flex", gap: 8, padding: "12px 24px", flexWrap: "wrap" }}>
          <input
            type="number"
            name="year"
            defaultValue={year ?? ""}
            placeholder="Filter by year (e.g. 2026)"
            aria-label="Filter by plan year"
            min={2020}
            max={2100}
            style={{ minHeight: 40, maxWidth: 220 }}
          />
          <button type="submit" className="btn primary" style={{ minHeight: 40 }}>Filter</button>
        </form>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "training plans" })} backHref="/learning" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No training plans yet"
            message={isHr ? "Create an annual training plan to assign courses and programmes to departments or roles." : "No plans published yet."}
          />
        ) : (
          <>
            <DataTable<Row>
              columns={[
                { key: "title", label: "Plan title" },
                { key: "planYear", label: "Year" },
                { key: "scope", label: "Scope" },
                { key: "status", label: "Status", cellType: "status" },
              ]}
              rows={rows}
              rowLinkKey="id"
              rowLinkPrefix="/learning/training-plans/"
              identifyingColumnKey="title"
              sortable
              pageSize={PAGE_SIZE}
            />
            {totalPages > 1 && (
              <div style={{ display: "flex", gap: 12, padding: "8px 24px 16px", alignItems: "center" }}>
                {page > 1 && (
                  <Link href={`/learning/training-plans?${new URLSearchParams({ ...(year ? { year: String(year) } : {}), page: String(page - 1) }).toString()}`} className="btn">
                    ← Previous
                  </Link>
                )}
                <span style={{ fontSize: 13, color: "var(--ink2)" }}>Page {page} of {totalPages}</span>
                {page < totalPages && (
                  <Link href={`/learning/training-plans?${new URLSearchParams({ ...(year ? { year: String(year) } : {}), page: String(page + 1) }).toString()}`} className="btn">
                    Next →
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
