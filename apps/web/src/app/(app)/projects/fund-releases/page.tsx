import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectFundReleases } from "../../../_data/loaders";
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  DataTable,
  StatusPill,
} from "@/app/_components/ds";
import type { FundReleaseSummary } from "@civitasone/types";

type FundReleaseRow = FundReleaseSummary & Record<string, unknown>;

const COLUMNS: {
  key: keyof FundReleaseRow & string;
  label: string;
  align?: "left" | "right";
  render?: (row: FundReleaseRow) => React.ReactNode;
}[] = [
  { key: "releaseNo", label: "Release No" },
  { key: "projectName", label: "Project" },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    render: (r) => `₹${((r.amount as number) / 100).toLocaleString("en-IN")}`,
  },
  { key: "releaseDate", label: "Release Date" },
  {
    key: "installmentNo",
    label: "Installment #",
    render: (r) => (r.installmentNo as number | undefined) != null ? String(r.installmentNo) : "—",
  },
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusPill status={r.status as string} />,
  },
];

export default async function FundReleasesPage() {
  const { data: releases, source } = await getProjectFundReleases();

  const totalReleased = releases.filter((r) => r.status === "released").reduce((s, r) => s + r.amount, 0);
  const totalSanctioned = releases.filter((r) => r.status === "sanctioned").reduce((s, r) => s + r.amount, 0);
  const totalUtilized = releases.filter((r) => r.status === "utilized").reduce((s, r) => s + r.amount, 0);

  const rows: FundReleaseRow[] = releases.map((r) => ({ ...r }));

  return (
    <>
      <PageHeader
        title="Fund Release Tracking"
        subtitle="Track releases to states/agencies, UC gating & PFMS flow."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={releases.length} />
        <StatCard
          icon="✅"
          iconBg="#ecfdf3"
          label="Released"
          value={`₹${(totalReleased / 100).toLocaleString("en-IN")}`}
        />
        <StatCard
          icon="📄"
          iconBg="#fffaeb"
          label="Sanctioned"
          value={`₹${(totalSanctioned / 100).toLocaleString("en-IN")}`}
        />
        <StatCard
          icon="💰"
          iconBg="#eff6ff"
          label="Utilized"
          value={`₹${(totalUtilized / 100).toLocaleString("en-IN")}`}
        />
      </StatGrid>
      <Card title="Fund Releases">
        <DataTable<FundReleaseRow>
          columns={COLUMNS}
          rows={rows}
        />
      </Card>
    </>
  );
}
