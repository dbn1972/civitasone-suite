import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  holder_name: string;
  designation: string;
  department: string;
  employee_code: string;
  card_type: string;
  card_number: string;
  vendor_name: string;
  valid_until: string;
  status: string;
  verification_count: number;
  issued_by_name: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/id-cards", [], {
    telemetryKey: "hr.id-cards",
    mapResponse: (p) => {
      const arr = (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
  { key: "card_number",        label: "Card #" },
  { key: "holder_name",        label: "Holder" },
  { key: "designation",        label: "Designation" },
  { key: "department",         label: "Department" },
  { key: "card_type",          label: "Type" },
  { key: "valid_until",        label: "Valid Until" },
  { key: "verification_count", label: "Verifications" },
  { key: "status",             label: "Status", cellType: "status" },
];

export default async function IdCardsPage() {
  const { data: items, source } = await getData();

  const active      = items.filter((i) => i.status === "active").length;
  const suspended   = items.filter((i) => i.status === "suspended").length;
  const employee    = items.filter((i) => i.card_type === "employee").length;
  const vendor      = items.filter((i) => i.card_type === "vendor_staff" || i.card_type === "project_team").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="ID Card Management"
        subtitle="Issue, manage, and verify digital identity cards for employees and vendor staff."
        back="/hr"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="🆔" iconBg="#e6f0ff" label="Total Cards"    value={items.length} />
        <StatCard icon="✅"          iconBg="#e6f7f0" label="Active"         value={active} />
        <StatCard icon="⏸️"          iconBg="#fffbe6" label="Suspended"      value={suspended} />
        <StatCard icon="👥"          iconBg="#f5f5f5" label="Vendor / Project" value={vendor} />
      </StatGrid>
      <Card title="ID Cards">
        <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by holder, card number, type or department…"
          pageSize={20}
          emptyIcon="🆔"
          emptyTitle="No ID cards issued"
          // HR-A deep-verify finding: this pointed users at a "card management
          // portal" that does not exist anywhere in the app (repo-wide grep
          // confirms zero matches beyond this string) -- this page is a
          // read-only list (no issue/suspend/revoke UI at all, though the
          // backend fully supports all of it). Removed the dead reference
          // rather than invent a destination.
          emptyMessage="ID cards for employees and vendor staff appear here once issued by HR administration."
        />
      </Card>
    </main>
  );
}
