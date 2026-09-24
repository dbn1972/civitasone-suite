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

  const pending = requests.filter((r) => r.status === "pending").length;
  const approved = requests.filter((r) => r.status === "approved").length;
  const totalHrs = requests.reduce((s, r) => s + (parseFloat(String(r.hoursRequested)) || 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
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
<StatCard icon="⏱️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={requests.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={approved} />
        <StatCard icon="🕐" iconBg="var(--bg, #f5f5f5)" label={t("statHours")} value={`${totalHrs.toFixed(1)} h`} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {result.source === "error" ? (
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
    </main>
  );
}
