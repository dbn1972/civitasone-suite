"use client";
import type { CRMCampaignRoiSummaryRow } from "@civitasone/types";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import { formatMoneyIn } from "@/lib/formatters";
import { formatRoiPercent, roiVerdict, type RoiVerdict } from "./campaigns";

type CampaignRow = {
  campaignId: string;
  name: string;
  verdict: RoiVerdict;
  /** ISO 4217 code of this campaign's money columns (GAP-CRM-CAMPAIGNS-DETAIL-03). */
  currency: string;
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
  const t = useTranslations("crmCampaignRoiTable");
  const tableRows: CampaignRow[] = rows.map((row) => ({
    campaignId: row.campaignId,
    name: row.name ?? t("unnamedCampaign"),
    verdict: roiVerdict(row),
    currency: row.currency,
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
        {
          key: "name",
          label: t("colCampaign"),
          render: (row) => (
            <div>
              <div>{row.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{row.campaignId}</div>
            </div>
          ),
        },
        {
          key: "verdict",
          label: "Outcome",
          render: (row) => <StatusPill status={VERDICT_LABEL[row.verdict]} />,
        },
        { key: "costMinor", label: "Spend", align: "right", render: (row) => formatMoneyIn(row.costMinor, row.currency) },
        { key: "revenueMinor", label: "Revenue", align: "right", render: (row) => formatMoneyIn(row.revenueMinor, row.currency) },
        { key: "netMinor", label: "Net", align: "right", render: (row) => formatMoneyIn(row.netMinor, row.currency) },
        { key: "roiPercent", label: "ROI", align: "right", render: (row) => formatRoiPercent(row.roiPercent) },
        { key: "responses", label: "Responses", align: "right", render: (row) => row.responses.toLocaleString("en-IN") },
        {
          key: "costPerResponseMinor",
          label: "Cost / Response",
          align: "right",
          render: (row) => (row.costPerResponseMinor ? formatMoneyIn(row.costPerResponseMinor, row.currency) : "—"),
        },
        { key: "periods", label: "Periods", align: "right" },
      ]}
      rows={tableRows}
      rowHref={(row) => `/crm/campaigns/${row.campaignId}`}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      exportable exportAudit="crm/campaigns"
      exportFilename="crm-campaign-roi"
      exportNotice="Exports leave the system; handle spend and revenue figures per policy."
      emptyIcon="📣"
      emptyTitle="No campaign spend recorded"
      emptyMessage="Campaign ROI appears once a marketing period's cost, revenue and responses have been posted against a campaign."
    />
  );
}
