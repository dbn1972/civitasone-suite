import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
  const t = await getTranslations();
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
    { key: "all", label: `All (${total})` },
    { key: "permanent", label: countByType.permanent ? `Permanent (${countByType.permanent})` : "Permanent" },
    { key: "contractual", label: countByType.contractual ? `Contractual (${countByType.contractual})` : "Contractual" },
    { key: "deputation", label: countByType.deputation ? `Deputation (${countByType.deputation})` : "Deputation" },
    { key: "consultant", label: countByType.consultant ? `Consultant (${countByType.consultant})` : "Consultant" },
  ];

  // The backend now applies the type filter itself (see getEmployees' employeeType
  // param / GET /v1/hrms/employees?employeeType=), so `employees` already reflects
  // `typeFilter` -- no client-side re-filtering needed (previously this incorrectly
  // re-filtered only the current 50-row page, using a field the API never returned).
  const filtered = employees;
  const filteredTotal = typeFilter === "all" ? total : (countByType[typeFilter] ?? 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("employees.title")}
        subtitle={t("common.search")}
        actions={
          <Link href="/hr/employees/new" className="btn primary">{t("employees.add")}</Link>
        }
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f7f0" label="Total" value={total} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Active (Serving)" value={active} />
        <StatCard icon="🌴" iconBg="#fffbe6" label="On Leave" value={onLeave} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Others" value={others} />
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
              color: typeFilter === tab.key ? "#fff" : "var(--ink)",
              textDecoration: "none", fontWeight: typeFilter === tab.key ? 600 : 400,
              border: "1px solid var(--line)",
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <Card title="All Employees">
        <EmployeesTable employees={filtered} source={source} />
      </Card>

      {filteredTotal > PAGE_SIZE && (
        <nav aria-label="Employee list pagination" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
          {page > 0 && (
            <Link
              href={empPageHref(typeFilter, page - 1)}
              className="btn"
            >
              {"←"} Previous
            </Link>
          )}
          <span style={{ color: "var(--ink2)" }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredTotal)} of {filteredTotal} employees
          </span>
          {(page + 1) * PAGE_SIZE < filteredTotal && (
            <Link
              href={empPageHref(typeFilter, page + 1)}
              className="btn"
            >
              Next {"→"}
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
