import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getEmployees, getHRDashboard } from "../../../_data/loaders";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

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

function empPageHref(type: string, p: number): string {
  const qs: string[] = [];
  if (type !== "all") qs.push("type=" + encodeURIComponent(type));
  if (p > 0) qs.push("page=" + p);
  return "/hr/employees" + (qs.length ? "?" + qs.join("&") : "");
}

export default async function EmployeeDirectoryPage({ searchParams }: { searchParams?: Record<string, string> }) {
  const page = Math.max(0, parseInt(searchParams?.page ?? "0") || 0);
  const typeFilter = searchParams?.type ?? "all";
  const [{ data: rawEmployees, source }, { data: hrDashboard }] = await Promise.all([
    getEmployees(PAGE_SIZE, page * PAGE_SIZE, typeFilter === "all" ? undefined : typeFilter),
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
  const total = page === 0 && !(source === "error") && employees.length === 0 ? 0 : (hrDashboard.headcount || employees.length);
  // NOTE: `active`/`others` below still derive from the current page only (same
  // page-scoped-math class as the type-tabs bug this fix targets), because there is
  // no existing tenant-wide "serving" aggregate to source them from without adding a
  // new backend query -- flagged as a follow-up, out of scope for this fix. `onLeave`
  // is fixed here since the dashboard already returns it tenant-wide.
  const active = employees.filter((e) => SERVING.has(e.status)).length;
  const onLeave = hrDashboard.onLeave;
  const others = total - active - onLeave;

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
  const filteredTotal = typeFilter === "all" ? total : (countByType[typeFilter] ?? 0);

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
          unreachable right now, risking duplicate records once it recovers. */}
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--goodbg, #e6f7f0)" label={t("statTotal")} value={source === "error" ? "—" : total} />
        <StatCard icon="✅" iconBg="var(--infobg, #e6f0ff)" label={t("statActiveShown")} value={source === "error" ? "—" : active} />
        <StatCard icon="🌴" iconBg="var(--warnbg, #fffbe6)" label={t("statOnLeave")} value={source === "error" ? "—" : onLeave} />
        <StatCard icon="📋" iconBg="var(--bg, #f5f5f5)" label={t("statOthersShown")} value={source === "error" ? "—" : others} />
      </StatGrid>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {TYPE_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/hr/employees" : `/hr/employees?type=${tab.key}`}
            className={typeFilter === tab.key ? "chip chip-active" : "chip"}
            aria-current={typeFilter === tab.key ? "page" : undefined}
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
      <Card title={t("cardTitle")}>
        <EmployeesTable employees={filtered} source={source} canCreate={canCreate} />
      </Card>

      {filteredTotal > PAGE_SIZE && (
        <nav aria-label={t("paginationAriaLabel")} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
          {page > 0 && (
            <Link
              href={empPageHref(typeFilter, page - 1)}
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
              href={empPageHref(typeFilter, page + 1)}
              className="btn"
            >
              {t("nextLabel")} {"→"}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
