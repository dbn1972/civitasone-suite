"use client";
import type { CRMCampaignRoiSummaryRow } from "@civitasone/types";
import { DataTable, StatusPill } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { formatRoiPercent, roiVerdict, type RoiVerdict } from "./campaigns";

type CampaignRow = {
  campaignId: string;
  verdict: RoiVerdict;
  costMinor: string;
  revenueMinor: string;
  netMinor: string;
  responses: number;
  roiPercent: string | null;
  costPerResponseMinor: string | null;
  periods: number;
};

const VERDICT_LABEL: Record<RoiVerdict, string> = {
  profit: "Profitable",
  loss: "Loss making",
  breakeven: "Break even",
  unmeasured: "No spend recorded",
};

export function CampaignRoiTable({ rows }: { rows: CRMCampaignRoiSummaryRow[] }) {
  const tableRows: CampaignRow[] = rows.map((row) => ({
    campaignId: row.campaignId,
    verdict: roiVerdict(row),
    costMinor: row.costMinor,
    revenueMinor: row.revenueMinor,
    netMinor: row.netMinor,
    responses: row.responses,
    roiPercent: row.roiPercent,
    costPerResponseMinor: row.costPerResponseMinor,
    periods: row.periods,
  }));

  return (
    <DataTable<CampaignRow>
      columns={[
        { key: "campaignId", label: "Campaign" },
        {
          key: "verdict",
          label: "Outcome",
          render: (row) => <StatusPill status={VERDICT_LABEL[row.verdict]} />,
        },
        { key: "costMinor", label: "Spend", align: "right", render: (row) => formatMoney(row.costMinor) },
        { key: "revenueMinor", label: "Revenue", align: "right", render: (row) => formatMoney(row.revenueMinor) },
        { key: "netMinor", label: "Net", align: "right", render: (row) => formatMoney(row.netMinor) },
        { key: "roiPercent", label: "ROI", align: "right", render: (row) => formatRoiPercent(row.roiPercent) },
        { key: "responses", label: "Responses", align: "right", render: (row) => row.responses.toLocaleString("en-IN") },
        {
          key: "costPerResponseMinor",
          label: "Cost / Response",
          align: "right",
          render: (row) => (row.costPerResponseMinor ? formatMoney(row.costPerResponseMinor) : "—"),
        },
        { key: "periods", label: "Periods", align: "right" },
      ]}
      rows={tableRows}
      rowHref={(row) => `/crm/campaigns/${row.campaignId}`}
      sortable
      filterable
      filterPlaceholder="Filter by campaign"
      exportable
      exportFilename="crm-campaign-roi"
      emptyIcon="📣"
      emptyTitle="No campaign spend recorded"
      emptyMessage="Campaign ROI appears once a marketing period's cost, revenue and responses have been posted against a campaign."
    />
  );
}
