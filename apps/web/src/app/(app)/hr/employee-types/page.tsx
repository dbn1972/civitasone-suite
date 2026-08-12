import Link from "next/link";
import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type EmpType = {
  id: string; code: string; name: string; description: string | null;
  eligibleForLeave: boolean; eligibleForPayroll: boolean; eligibleForAppraisal: boolean;
  defaultProbationMonths: number; maxContractMonths: number | null;
  payMode: string; isActive: boolean; sortOrder: number;
} & Record<string, unknown>;

async function getTypes(): Promise<LoaderResult<EmpType[]>> {
  const r = await fetchJson<unknown, EmpType[]>("/api/v1/hrms/employee-types", [], {
    telemetryKey: "config.employee_types",
    mapResponse: (p) => (p as { data: EmpType[] })?.data ?? null,
  });
  return r;
}

const PAY_MODE_LABELS: Record<string, string> = {
  monthly: "Monthly salary",
  hourly: "Hourly rate",
  consolidated: "Consolidated (fixed)",
  stipend: "Stipend",
  none: "No pay",
};

export default async function EmployeeTypesPage() {
  const { data: types, source } = await getTypes();
  const active = types.filter((t) => t.isActive).length;
  const withPayroll = types.filter((t) => t.eligibleForPayroll).length;

  const rows = types.map((t) => ({
    ...t,
    payModeLabel: PAY_MODE_LABELS[t.payMode] ?? t.payMode,
    probation: t.defaultProbationMonths > 0 ? `${t.defaultProbationMonths} months` : "None",
    contract: t.maxContractMonths ? `${t.maxContractMonths} months max` : "Unlimited",
    leave: t.eligibleForLeave ? "✅" : "—",
    payroll: t.eligibleForPayroll ? "✅" : "—",
    appraisal: t.eligibleForAppraisal ? "✅" : "—",
  }));

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Employee Types"
        subtitle="Define the categories of people in your organisation — permanent staff, contractors, interns, volunteers, and any custom type you need."
        back="/hr"
        backLabel="HR"
        help="hr"
      />
      {source === "error" && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="👥" iconBg="#e7edfd" label="Total Types" value={types.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="💰" iconBg="#fffaeb" label="On Payroll" value={withPayroll} />
      </StatGrid>

      <Card title="Employee Type Master">
        {types.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No employee types defined"
            message="Define the categories of people who work in your organisation (e.g. Permanent, Contract, Intern)."
          />
        ) : (
          <DataTable
            columns={[
              { key: "code", label: "Code" },
              { key: "name", label: "Type Name" },
              { key: "payModeLabel", label: "Pay Mode" },
              { key: "probation", label: "Probation" },
              { key: "contract", label: "Max Duration" },
              { key: "leave", label: "Leave" },
              { key: "payroll", label: "Payroll" },
              { key: "appraisal", label: "Appraisal" },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Search employee types…"
          />
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card padding>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>About employee types</h3>
          <p style={{ margin: 0, color: "var(--mut)", fontSize: 13.5, lineHeight: 1.6 }}>
            Each type controls how the system handles that category of person:
          </p>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--ink2)", fontSize: 13.5, lineHeight: 1.7 }}>
            <li><strong>Pay mode:</strong> Monthly (regular salary), Consolidated (fixed lump sum), Stipend (interns/apprentices), Hourly, or None (volunteers).</li>
            <li><strong>Leave eligibility:</strong> Whether this type gets leave entitlements. Volunteers typically don&apos;t.</li>
            <li><strong>Payroll:</strong> Whether salary slips are generated. Volunteers and some consultants may be excluded.</li>
            <li><strong>Appraisal:</strong> Whether they go through the yearly performance review cycle.</li>
            <li><strong>Max duration:</strong> For fixed-term types (contract, intern), the maximum engagement period.</li>
          </ul>
          <p style={{ margin: "12px 0 0", color: "var(--mut)", fontSize: 12.5 }}>
            Add new types via <code>POST /v1/hrms/employee-types</code>. Any type you create here becomes available when adding employees.
          </p>
        </Card>
      </div>
    </main>
  );
}
