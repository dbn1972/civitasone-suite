import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getEmployees, getHRDashboard } from "../../../_data/loaders";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";
import { getTranslations } from "next-intl/server";

const TYPE_LABELS: Record<string, string> = {
  permanent: "Permanent",
  probation: "On Probation",
  contractual: "Contractual",
  deputation: "Deputation",
  consultant: "Consultant",
  intern: "Intern / Trainee",
};

export default async function EmployeeDirectoryPage({ searchParams }: { searchParams?: Record<string, string> }) {
  const [{ data: rawEmployees, source }, { data: hrDashboard }] = await Promise.all([
    getEmployees(),
    getHRDashboard(),
  ]);
  const t = await getTranslations();
  const employees = rawEmployees as EmpRow[];

  const SERVING = new Set(["probation", "confirmed", "deputation"]);
  const total = hrDashboard.headcount || employees.length;
  const active = employees.filter((e) => SERVING.has(e.status)).length;
  const onLeave = employees.filter((e) => e.status === "on_leave").length;
  const others = total - active - onLeave;

  const typeFilter = searchParams?.type ?? "all";
  const filtered = typeFilter === "all"
    ? employees
    : employees.filter((e) => {
        const raw = e as Record<string, unknown>;
        return (raw.employeeTypeCode ?? raw.status ?? "") === typeFilter;
      });

  // Count employees per type for filter tab badges
  const countByType = employees.reduce<Record<string, number>>((acc, e) => {
    const raw = e as Record<string, unknown>;
    const key = String(raw.employeeTypeCode ?? raw.status ?? "other");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const TYPE_TABS = [
    { key: "all", label: `All (${total})` },
    { key: "permanent", label: countByType.permanent ? `Permanent (${countByType.permanent})` : "Permanent" },
    { key: "contractual", label: countByType.contractual ? `Contractual (${countByType.contractual})` : "Contractual" },
    { key: "deputation", label: countByType.deputation ? `Deputation (${countByType.deputation})` : "Deputation" },
    { key: "consultant", label: countByType.consultant ? `Consultant (${countByType.consultant})` : "Consultant" },
  ];

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
    </main>
  );
}
