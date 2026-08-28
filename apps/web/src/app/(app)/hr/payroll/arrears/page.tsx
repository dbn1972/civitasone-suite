import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";

// Wire shape from GET /v1/payroll/arrears (payroll-service, world-class-routes.ts ->
// repo.listArrears -> `SELECT * FROM payroll.payroll_arrears`). These are the literal
// DB columns (migrations/0035_world_class_payroll.sql + 0011 `source` column) — there
// is no `employee`/`department`/`arrearType`/`period`/`amount`/`payableMonth` field on
// the wire. This type documents what the API actually sends so the mapper below can't
// silently drift from it again.
type ArrearApiRow = {
  id: string;
  employee_id: string;
  run_id: string | null;
  component_code: string;
  from_period: string;
  to_period: string;
  old_amount_minor: number | string;
  new_amount_minor: number | string;
  difference_minor: number | string;
  reason: string | null;
  status: string;
  source: string;
  created_at: string;
} & Record<string, unknown>;

type Row = {
  id: string;
  employee_id: string;
  component_code: string;
  from_period: string;
  to_period: string;
  difference_minor: number | string;
  reason: string;
  status: string;
} & Record<string, unknown>;

/**
 * Translate the raw payroll_arrears columns into what the table needs. Kept as an
 * explicit function (rather than typing the table straight off the wire row) so the
 * two shapes can't drift apart unnoticed the way they previously did: the table used
 * to ask for `employee`/`department`/`arrearType`/`period`/`amount`/`payableMonth`,
 * none of which the API has ever sent, so every real row rendered blank.
 *
 * `employee_id`/`component_code` are shown as-is (no name/label lookup) — same
 * convention as the bonus, reimbursements, and salary-revisions screens, none of
 * which resolve employee_id to a display name or component_code to a friendly label.
 * `difference_minor` (new - old, in paise) is the amount actually owed; it is kept in
 * minor units for the table's `cellType: "amount"` (formatMoney) rendering — never
 * convert to a float rupee value before display.
 */
function mapArrearRow(r: ArrearApiRow): Row {
  return {
    ...r,
    id: r.id,
    employee_id: r.employee_id,
    component_code: r.component_code,
    from_period: r.from_period,
    to_period: r.to_period,
    difference_minor: r.difference_minor ?? 0,
    reason: r.reason ?? "—",
    status: r.status,
  };
}

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/arrears", [], {
    telemetryKey: "payroll.arrears",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ArrearApiRow[] })?.data;
      return Array.isArray(arr) ? arr.map(mapArrearRow) : null;
    },
  });
  return r;
}

export default async function ArrearsPage() {
  const { data: items, source } = await getData();

  const columns: {
    key: keyof Row & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "employee_id", label: "Employee" },
    { key: "component_code", label: "Arrear Type" },
    { key: "from_period", label: "From Period" },
    { key: "to_period", label: "To Period" },
    { key: "difference_minor", label: "Amount", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
    { key: "reason", label: "Reason" },
  ];

  const totalArrearsMinor = items.reduce((sum, i) => sum + Number(i.difference_minor ?? 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Arrears Computation" subtitle="Arrears due to DA revision, promotions, and pay fixation." back="/hr" />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label="Total" value={items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Pending" value={items.filter((i) => i.status === "pending").length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Approved/Paid" value={items.filter((i) => i.status === "approved" || i.status === "paid").length} />
        <StatCard icon="💰" iconBg="var(--panel)" label="Total Arrears Amount" value={formatMoney(totalArrearsMinor)} />
      </StatGrid>
      <Card title="Arrears Register">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or period…" pageSize={15} emptyIcon="📋" emptyTitle="No arrears computed" emptyMessage="Arrears arise from DA revisions, promotions, and pay fixations applied retroactively. They appear here automatically after each payroll run that includes a backdated revision." />
      </Card>
    </main>
  );
}
