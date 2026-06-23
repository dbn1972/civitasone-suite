import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getSchemes } from "../../../_data/loaders";
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  DataTable,
  StatusPill,
} from "@/app/_components/ds";
import type { SchemeSummary } from "@civitasone/types";

type SchemeRow = SchemeSummary & Record<string, unknown>;

const COLUMNS: {
  key: keyof SchemeRow & string;
  label: string;
  align?: "left" | "right";
  render?: (row: SchemeRow) => React.ReactNode;
}[] = [
  { key: "schemeCode", label: "Scheme Code" },
  { key: "name", label: "Name" },
  {
    key: "ministry",
    label: "Ministry / Dept",
    render: (r) => {
      const min = r.ministry as string | undefined;
      const dep = r.department as string | undefined;
      return min ?? dep ?? "—";
    },
  },
  { key: "fundingType", label: "Funding Type" },
  {
    key: "totalAllocation",
    label: "Allocation",
    align: "right",
    render: (r) => `₹${((r.totalAllocation as number) / 100).toLocaleString("en-IN")}`,
  },
  {
    key: "releasedAmount",
    label: "Released",
    align: "right",
    render: (r) => `₹${((r.releasedAmount as number) / 100).toLocaleString("en-IN")}`,
  },
  {
    key: "projectCount",
    label: "Projects #",
    align: "right",
  },
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusPill status={r.status as string} />,
  },
];

export default async function SchemesPage() {
  const { data: schemes, source } = await getSchemes();

  const active = schemes.filter((s) => s.status === "active").length;
  const totalAllocation = schemes.reduce((sum, s) => sum + s.totalAllocation, 0);
  const totalReleased = schemes.reduce((sum, s) => sum + s.releasedAmount, 0);

  const rows: SchemeRow[] = schemes.map((s) => ({ ...s }));

  return (
    <>
      <PageHeader
        title="Schemes"
        subtitle="Physical & financial progress, beneficiaries — scheme-wise."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={schemes.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard
          icon="💰"
          iconBg="#eff6ff"
          label="Total Allocation"
          value={`₹${(totalAllocation / 100).toLocaleString("en-IN")}`}
        />
        <StatCard
          icon="📤"
          iconBg="#fffaeb"
          label="Released"
          value={`₹${(totalReleased / 100).toLocaleString("en-IN")}`}
        />
      </StatGrid>
      <Card title="Schemes">
        <DataTable<SchemeRow>
          columns={COLUMNS}
          rows={rows}
        />
      </Card>
    </>
  );
}
