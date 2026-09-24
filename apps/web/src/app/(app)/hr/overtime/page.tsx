import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type OTRequest = {
  id: string;
  employeeId: string;
  requestDate: string;
  hoursRequested: string;
  reason: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
} & Record<string, unknown>;

async function getOvertimeRequests(): Promise<LoaderResult<OTRequest[]>> {
  return fetchJson<unknown, OTRequest[]>("/api/v1/hrms/overtime-requests", [], {
    telemetryKey: "overtime.list",
    mapResponse: (p) => {
      const arr = (p as Record<string, unknown>)?.data;
      return Array.isArray(arr) ? (arr as OTRequest[]) : null;
    },
  });
}

export default async function OvertimePage() {
  const t = await getTranslations("overtime");
  const COLUMNS: { key: keyof OTRequest & string; label: string; cellType?: "status" }[] = [
    { key: "employeeId",     label: t("colEmployee") },
    { key: "requestDate",    label: t("colDate") },
    { key: "hoursRequested", label: t("colHours") },
    { key: "reason",         label: t("colReason") },
    { key: "status",         label: t("colStatus"), cellType: "status" },
  ];
  const result = await getOvertimeRequests();
  const requests = result.data;
  // Fabricated-data fix: this was the only one of the attendance-adjacent
  // self-service pages whose stat cards weren't gated on fetch failure --
  // requests defaults to [] on error (see getOvertimeRequests' fetchJson
  // fallback), so every stat below silently rendered as a genuine "0"
  // instead of the honest "we don't know" the sibling pages already show
  // (work-summary/page.tsx, travel/page.tsx, advances/page.tsx, loans/page.tsx,
  // expenses/page.tsx all gate the same way). StatCard's own displayValue
  // renders null as "—", so this is a value-level guard, not a new render path.
  const errored = result.source === "error";
  const pending = requests.filter((r) => r.status === "pending").length;
  const approved = requests.filter((r) => r.status === "approved").length;
  const totalHrs = requests.reduce((s, r) => s + (parseFloat(String(r.hoursRequested)) || 0), 0);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={
          <Link href="/hr/overtime/new" className="btn primary">{t("newRequest")}</Link>
        }
      />
      <DataSourceBadge source={result.source} />
      <StatGrid>
<StatCard icon="⏱️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : requests.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="🕐" iconBg="var(--bg, #f5f5f5)" label={t("statHours")} value={errored ? null : `${totalHrs.toFixed(1)} h`} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "overtime requests" })} backHref="/hr" />
        ) : requests.length === 0 ? (
          <EmptyState
            icon="⏱️"
            title={t("noRequestsTitle")}
            message={t("noRequestsMessage")}
            action={<Link href="/hr/overtime/new" className="btn primary">{t("newRequest")}</Link>}
          />
        ) : (
          <DataTable<OTRequest>
            columns={COLUMNS}
            rows={requests}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={20}
            emptyIcon="⏱️"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
