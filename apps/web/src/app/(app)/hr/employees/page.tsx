import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getEmployees, getHRDashboard } from "../../../_data/loaders";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { humanizeStatus } from "@/lib/formatters";

const PAGE_SIZE = 50;

/**
 * GAP-HR-EMPLOYEES-05: known, translated tab labels for the four legacy
 * employee-type codes this tenant is most likely to have. Any other code
 * (a tenant-defined type, or a legacy code like "intern") still gets a tab
 * -- just with a humanized label instead of a translated one -- rather
 * than being invisible until someone edits this file (the previous
 * hard-coded 4-tab array's actual bug).
 */
const KNOWN_TYPE_TAB_KEYS: Record<string, string> = {
  permanent: "tabPermanentCount",
  contractual: "tabContractualCount",
  deputation: "tabDeputationCount",
  consultant: "tabConsultantCount",
};

function humanizeTypeCode(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Mirrors hr/employees/new/page.tsx's EMPLOYEE_ADMIN_ROLES exactly (that
 * page's own POST /v1/hrms/employees gate). Without this, a role that can
 * view this directory but isn't in the list (e.g. "manager") saw a fully
 * working "Add Employee" button that led straight to that page's
 * PermissionDenied wall -- same bug class as hr/departments/new's own doc
 * comment already describes for that module.
 */
const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

/**
 * GAP-HR-EMPLOYEES-06: canonical lowercase statuses the server-side ?status=
 * filter accepts (services/hrms-service employee/status.ts EMPLOYEE_STATUSES --
 * keep in sync). Anything else in the URL is ignored rather than forwarded.
 */
const STATUS_FILTERS = [
  "probation", "confirmed", "on_leave", "suspended", "deputation", "retired", "separated", "terminated", "no_show",
] as const;

function empPageHref(type: string, p: number, q: string, status = ""): string {
  const qs: string[] = [];
  if (type !== "all") qs.push("type=" + encodeURIComponent(type));
  if (status) qs.push("status=" + encodeURIComponent(status));
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
  const rawStatus = searchParams?.status ?? "";
  const statusFilter = (STATUS_FILTERS as readonly string[]).includes(rawStatus) ? rawStatus : "";
  const [{ data: rawEmployees, source }, { data: hrDashboard, source: dashboardSource }] = await Promise.all([
    getEmployees(PAGE_SIZE, page * PAGE_SIZE, typeFilter === "all" ? undefined : typeFilter, q || undefined, statusFilter || undefined),
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
  // GAP-HR-EMPLOYEES-01: all four cards are tenant-wide aggregates from the
  // HR dashboard (headcount / serving / onLeave) and so identical on every
  // ?page=, ?type=, ?status= and ?q= view -- Active used to count only the
  // 50 rows on the current page and Others subtracted that page count from
  // the tenant total. servingCount is null when the backend did not report
  // it; the cards then show a dash rather than a computed guess.
  const servingCount = hrDashboard.servingCount ?? null;
  const active = servingCount;
  const onLeave = hrDashboard.onLeave;
  const others = servingCount === null ? null : Math.max(0, total - servingCount - onLeave);

  // Tenant-wide, independent of pagination -- see dashboard/queries.ts employeeTypeBreakdown.
  const countByType: Record<string, number> = Object.fromEntries(
    hrDashboard.employeeTypeBreakdown.map((b) => [b.name, b.count]),
  );

  // GAP-HR-EMPLOYEES-05: built from the tenant's actual employeeTypeBreakdown
  // (a tenant-defined type -- intern, volunteer, a custom code -- now gets a
  // tab with its real count) instead of a fixed 4-entry array that silently
  // couldn't represent anything else. Sorted by count desc, per the
  // acceptance list, so the tab order doesn't jump around between renders.
  const TYPE_TABS = [
    { key: "all", label: t("tabAll", { count: total }) },
    ...hrDashboard.employeeTypeBreakdown
      .slice()
      .sort((a, b) => b.count - a.count)
      .map((b) => ({
        key: b.name,
        label: KNOWN_TYPE_TAB_KEYS[b.name]
          ? t(KNOWN_TYPE_TAB_KEYS[b.name], { count: b.count })
          : `${humanizeTypeCode(b.name)} (${b.count})`,
      })),
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
  const filteredTotal = q || statusFilter ? undefined : (typeFilter === "all" ? total : (countByType[typeFilter] ?? 0));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        help="hr"
        actions={
          canCreate ? (
            <div style={{ display: "flex", gap: 8 }}>
              {/* GAP-HR-EMPLOYEES-03 / GAP-HR-EMPLOYEES-IMPORT-06: the bulk
                  import page (role-gated identically to this button) existed
                  but had no link to it anywhere in the app. */}
              <Link href="/hr/employees/import" className="btn ghost">{t("import")}</Link>
              <Link href="/hr/employees/new" className="btn primary">{t("add")}</Link>
            </div>
          ) : undefined
        }
      />
      {/* UX-012: the data-source badge now lives inside EmployeesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      {/* GAP-HR-EMPLOYEES-02: a load failure must not render as "0 of
          everything" -- that reads exactly like a genuinely empty tenant,
          and (see EmployeesTable below) used to invite an HR admin to
          "add your first employee" into a workforce that's actually just
          unreachable right now, risking duplicate records once it recovers.
          Two independent fetches feed this grid -- getEmployees (`source`)
          and getHRDashboard (`dashboardSource`) -- and each stat is only as
          trustworthy as the fetch(es) it actually derives from. Gating every
          card on `source` alone left a dashboard-only failure completely
          unindicated: `total`/`others` would silently fall back to the
          current page's row count (hrDashboard.headcount defaults to 0 on
          error, so `hrDashboard.headcount || employees.length` resolves to
          `employees.length`) and `onLeave` would silently show 0 -- both
          rendered as if they were real tenant-wide numbers. Total/Others mix
          both fetches, so either failing blanks them; Active is derived only
          from the employees page; OnLeave only from the dashboard. */}
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--goodbg, #e6f7f0)" label={t("statTotal")} value={source === "error" || dashboardSource === "error" ? "—" : total} />
        <StatCard icon="✅" iconBg="var(--infobg, #e6f0ff)" label={t("statActive")} value={dashboardSource === "error" || active === null ? "—" : active} />
        <StatCard icon="🌴" iconBg="var(--warnbg, #fffbe6)" label={t("statOnLeave")} value={dashboardSource === "error" ? "—" : onLeave} />
        <StatCard icon="📋" iconBg="var(--bg, #f5f5f5)" label={t("statOthers")} value={source === "error" || dashboardSource === "error" || others === null ? "—" : others} />
      </StatGrid>
      {/* GAP-HR-EMPLOYEES-06: "Others" had no legend -- say what it contains. */}
      <p style={{ margin: "-4px 0 12px", fontSize: 12, color: "var(--mut)" }}>{t("othersLegend")}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {TYPE_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={empPageHref(tab.key, 0, "", statusFilter)}
            className="chip chip-link"
            aria-current={typeFilter === tab.key ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* GAP-HR-EMPLOYEES-06: server-side status filter (second chip row). */}
      <nav aria-label={t("statusFilterLabel")} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link
          href={empPageHref(typeFilter, 0, "")}
          className="chip chip-link"
          aria-current={statusFilter === "" ? "page" : undefined}
        >
          {t("statusAll")}
        </Link>
        {STATUS_FILTERS.map((st) => (
          <Link
            key={st}
            href={empPageHref(typeFilter, 0, "", st)}
            className="chip chip-link"
            aria-current={statusFilter === st ? "page" : undefined}
          >
            {humanizeStatus(st)}
          </Link>
        ))}
      </nav>

      {/* GAP-HR-EMPLOYEES-04: server-side search form -- preserves the
          current type tab (page resets to 0, a new search is a new result
          set). */}
      <form
        method="GET"
        role="search"
        style={{ display: "flex", gap: 8, marginBottom: 12, maxWidth: 420 }}
      >
        {typeFilter !== "all" && <input type="hidden" name="type" value={typeFilter} />}
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
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
          <Link href={empPageHref(typeFilter, 0, "", statusFilter)} className="btn ghost">Clear</Link>
        )}
      </form>

      <Card title={t("cardTitle")}>
        <EmployeesTable employees={filtered} source={source} canCreate={canCreate} />
      </Card>

      {filteredTotal !== undefined && filteredTotal > PAGE_SIZE && (
        <nav aria-label={t("paginationAriaLabel")} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
          {page > 0 && (
            <Link
              href={empPageHref(typeFilter, page - 1, q, statusFilter)}
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
              href={empPageHref(typeFilter, page + 1, q, statusFilter)}
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
      {(q || statusFilter) && filteredTotal === undefined && filtered.length === PAGE_SIZE && (
        <nav aria-label={t("paginationAriaLabel")} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
          {page > 0 && <Link href={empPageHref(typeFilter, page - 1, q, statusFilter)} className="btn">{"←"} {t("prevLabel")}</Link>}
          <Link href={empPageHref(typeFilter, page + 1, q, statusFilter)} className="btn">{t("nextLabel")} {"→"}</Link>
        </nav>
      )}
    </div>
  );
}
