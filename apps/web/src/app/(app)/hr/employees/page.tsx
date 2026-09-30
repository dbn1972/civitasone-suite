import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getEmployees, getHRDashboard } from "../../../_data/loaders";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

const PAGE_SIZE = 50;

/**
 * Mirrors hr/employees/new/page.tsx's EMPLOYEE_ADMIN_ROLES exactly (that
 * page's own POST /v1/hrms/employees gate). Without this, a role that can
 * view this directory but isn't in the list (e.g. "manager") saw a fully
 * working "Add Employee" button that led straight to that page's
 * PermissionDenied wall -- same bug class as hr/departments/new's own doc
 * comment already describes for that module.
 */
const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

function empPageHref(type: string, p: number, q: string): string {
  const qs: string[] = [];
  if (type !== "all") qs.push("type=" + encodeURIComponent(type));
  if (p > 0) qs.push("page=" + p);
  if (q) qs.push("q=" + encodeURIComponent(q));
  return "/hr/employees" + (qs.length ? "?" + qs.join("&") : "");
}

export default async function EmployeeDirectoryPage({ searchParams }: { searchParams?: Record<string, string> }) {
  const page = Math.max(0, parseInt(searchParams?.page ?? "0") || 0);
  const typeFilter = searchParams?.type ?? "all";
  // GAP-HR-EMPLOYEES-04: real server-side search, forwarded to the backend
  // (see loaders.ts's getEmployees) instead of only ever filtering whatever
  // 50 rows happened to be on the current server page.
  const q = (searchParams?.q ?? "").trim();
  const [{ data: rawEmployees, source }, { data: hrDashboard }] = await Promise.all([
    getEmployees(PAGE_SIZE, page * PAGE_SIZE, typeFilter === "all" ? undefined : typeFilter, q || undefined),
    getHRDashboard(),
  ]);
  const t = await getTranslations("employees");
  const employees = rawEmployees as EmpRow[];
  const roles = getSessionRoles();
  const canCreate = roles.some((r) => EMPLOYEE_ADMIN_ROLES.includes(r));

  const SERVING = new Set(["probation", "confirmed", "deputation"]);
  // hrDashboard.headcount is a separately-scoped aggregate (see
  // getHRDashboard/mapHRDashboard) that can disagree with the concrete rows
  // this page actually fetched -- e.g. a first-time manager whose dashboard
  // summary reports headcount:1 while their own direct-reports query (this
  // page's `employees`) genuinely returns none yet. Trusting headcount
  // unconditionally then showed "Total: 1" right next to EmployeesTable's
  // own "no employees yet -- add your first one" empty state: same page,
  // two disagreeing numbers. On page 0 (the only page where "empty" can't
  // just mean "off the end of a longer list"), an empty `employees` is the
  // more trustworthy signal for THIS viewer's scope, so the header/tabs/
  // pagination total all fall back to 0 and agree with what's actually on
  // screen. Beyond page 0, a legitimately out-of-range page must not zero
  // out a real headcount -- same reasoning applies for hr_admin as manager,
  // it just practically triggers only when a scoped query and the
  // dashboard aggregate disagree, which is rarer tenant-wide.
  // UX-001: `source` (destructured above from getEmployees()) tells us whether
  // this page's own scoped query actually loaded -- an empty `employees` from
  // a genuine fetch failure must not collapse to the same "confirmed zero"
  // reading as a real empty roster, or a network blip would show "Total: 0"
  // as if that were trustworthy data instead of falling back to headcount.
  // A search (`q`) legitimately narrows `employees` to far fewer rows than
  // the tenant total on purpose -- must not be mistaken for "genuinely
  // empty roster" the way an un-searched empty page 0 is.
  const total = page === 0 && !q && !(source === "error") && employees.length === 0 ? 0 : (hrDashboard.headcount || employees.length);
  // GAP-HR-EMPLOYEES-01: active/others below still derive from the current
  // page only, same page-scoped-math class as the type-tabs bug fixed
  // earlier -- there is no existing tenant-wide "serving" aggregate to
  // source them from. NOT fixed in this pass: the natural backend home for
  // that aggregate (dashboard/queries.ts's getDashboard, same transaction
  // as headcount/onLeave) is being actively extended by open PR #1702
  // (GAP-HR-DASHBOARD-06/07) in the exact same destructured-query-result
  // pattern a new "servingCount" field would also need to touch --
  // implementing it here now would create a near-certain merge conflict on
  // shared lines. Deferring until #1702 lands, then this becomes a small,
  // additive follow-up instead of a competing edit to code already under
  // review. `onLeave` is unaffected (already tenant-wide via the dashboard).
  const active = employees.filter((e) => SERVING.has(e.status)).length;
  const onLeave = hrDashboard.onLeave;
  const others = total - active - onLeave;

  // Tenant-wide, independent of pagination -- see dashboard/queries.ts employeeTypeBreakdown.
  const countByType: Record<string, number> = Object.fromEntries(
    hrDashboard.employeeTypeBreakdown.map((b) => [b.name, b.count]),
  );

  const TYPE_TABS = [
    { key: "all", label: t("tabAll", { count: total }) },
    { key: "permanent", label: countByType.permanent ? t("tabPermanentCount", { count: countByType.permanent }) : t("tabPermanent") },
    { key: "contractual", label: countByType.contractual ? t("tabContractualCount", { count: countByType.contractual }) : t("tabContractual") },
    { key: "deputation", label: countByType.deputation ? t("tabDeputationCount", { count: countByType.deputation }) : t("tabDeputation") },
    { key: "consultant", label: countByType.consultant ? t("tabConsultantCount", { count: countByType.consultant }) : t("tabConsultant") },
  ];

  // The backend now applies the type filter itself (see getEmployees' employeeType
  // param / GET /v1/hrms/employees?employeeType=), so `employees` already reflects
  // `typeFilter` -- no client-side re-filtering needed (previously this incorrectly
  // re-filtered only the current 50-row page, using a field the API never returned).
  const filtered = employees;
  // A search narrows the true matching total to something this page cannot
  // know without a dedicated count query -- rather than show a wrong
  // "Showing 1-50 of <tenant total>" while searching, pagination controls
  // are keyed off how many rows this page actually got back.
  const filteredTotal = q ? undefined : (typeFilter === "all" ? total : (countByType[typeFilter] ?? 0));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        help="hr"
        actions={
          canCreate ? <Link href="/hr/employees/new" className="btn primary">{t("add")}</Link> : undefined
        }
      />
      {/* UX-012: the data-source badge now lives inside EmployeesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--goodbg, #e6f7f0)" label={t("statTotal")} value={total} />
        <StatCard icon="✅" iconBg="var(--infobg, #e6f0ff)" label={t("statActiveShown")} value={active} />
        <StatCard icon="🌴" iconBg="var(--warnbg, #fffbe6)" label={t("statOnLeave")} value={onLeave} />
        <StatCard icon="📋" iconBg="var(--bg, #f5f5f5)" label={t("statOthersShown")} value={others} />
      </StatGrid>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {TYPE_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/hr/employees" : `/hr/employees?type=${tab.key}`}
            className={typeFilter === tab.key ? "chip chip-active" : "chip"}
            style={{
              fontSize: 13, padding: "5px 12px", borderRadius: 20,
              background: typeFilter === tab.key ? "var(--primary)" : "var(--bg2)",
              color: typeFilter === tab.key ? "var(--panel, #fff)" : "var(--ink)",
              textDecoration: "none", fontWeight: typeFilter === tab.key ? 600 : 400,
              border: "1px solid var(--line)",
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* GAP-HR-EMPLOYEES-04: server-side search form -- preserves the
          current type tab (page resets to 0, a new search is a new result
          set). */}
      <form
        method="GET"
        role="search"
        style={{ display: "flex", gap: 8, marginBottom: 12, maxWidth: 420 }}
      >
        {typeFilter !== "all" && <input type="hidden" name="type" value={typeFilter} />}
        <label htmlFor="employees-search" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {t("search")}
        </label>
        <input
          id="employees-search"
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t("search")}
          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: 14 }}
        />
        <button type="submit" className="btn">{t("search")}</button>
        {q && (
          <Link href={empPageHref(typeFilter, 0, "")} className="btn ghost">Clear</Link>
        )}
      </form>

      <Card title={t("cardTitle")}>
        <EmployeesTable employees={filtered} source={source} canCreate={canCreate} />
      </Card>

      {filteredTotal !== undefined && filteredTotal > PAGE_SIZE && (
        <nav aria-label={t("paginationAriaLabel")} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
          {page > 0 && (
            <Link
              href={empPageHref(typeFilter, page - 1, q)}
              className="btn"
            >
              {"←"} {t("prevLabel")}
            </Link>
          )}
          <span style={{ color: "var(--ink2)" }}>
            {t("showingRange", { from: page * PAGE_SIZE + 1, to: Math.min((page + 1) * PAGE_SIZE, filteredTotal), total: filteredTotal })}
          </span>
          {(page + 1) * PAGE_SIZE < filteredTotal && (
            <Link
              href={empPageHref(typeFilter, page + 1, q)}
              className="btn"
            >
              {t("nextLabel")} {"→"}
            </Link>
          )}
        </nav>
      )}
      {/* A search result set that fills a whole page (exactly PAGE_SIZE rows)
          might have more matches beyond it -- filteredTotal is intentionally
          unknown while searching (see above), so offer a plain "next page of
          results" link rather than a false-precision total. */}
      {q && filteredTotal === undefined && filtered.length === PAGE_SIZE && (
        <nav aria-label={t("paginationAriaLabel")} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
          {page > 0 && <Link href={empPageHref(typeFilter, page - 1, q)} className="btn">{"←"} {t("prevLabel")}</Link>}
          <Link href={empPageHref(typeFilter, page + 1, q)} className="btn">{t("nextLabel")} {"→"}</Link>
        </nav>
      )}
    </div>
  );
}
