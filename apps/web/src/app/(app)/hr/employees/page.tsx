import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getEmployees, getHRDashboard } from "../../../_data/loaders";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";
import { getTranslations } from "next-intl/server";

const PAGE_SIZE = 50;

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

  const SERVING = new Set(["probation", "confirmed", "deputation"]);
  const total = hrDashboard.headcount || employees.length;
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
  const filteredTotal = typeFilter === "all" ? total : (countByType[typeFilter] ?? 0);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        help="hr"
        actions={
          <Link href="/hr/employees/new" className="btn primary">{t("add")}</Link>
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
      <Card title={t("cardTitle")}>
        <EmployeesTable employees={filtered} source={source} />
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
