import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { WFHRequestForm } from "../../_components/WFHRequestForm";
import { toHumanError } from "@/lib/messages";

/**
 * WFHPage — Work From Home requests and approvals.
 * DoPT WFH policy: max 2 days/week for eligible cadres.
 * Status chips: Pending / Approved / Rejected / Recalled.
 */

type Row = {
  id: string;
  employeeName: string;
  department: string;
  fromDate: string;
  toDate: string;
  days: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/wfh-requests", [], {
    telemetryKey: "hr.workforce.wfh",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({
        ...r,
        employeeName: (r as Record<string, unknown>).employeeName as string ?? r.employeeId,
        department: r.department ?? "—",
        days: r.days ?? "—",
        reason: r.reason ?? "—",
      }));
    },
  });
}

export default async function WFHPage() {
  const t = await getTranslations("workforceWfh");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;
  const recalled = items.filter((i) => i.status === "recalled").length;

  const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employeeName", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "fromDate", label: t("colFrom") },
    { key: "toDate", label: t("colTo") },
    { key: "days", label: t("colDays") },
    { key: "reason", label: t("colReason") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏠" iconBg="#e6f0ff" label={t("statTotalRequests")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="↩️" iconBg="#fff0f0" label={t("statRejectedRecalled")} value={errored ? null : rejected + recalled} />
      </StatGrid>

      <Card title={t("cardNewRequest")}>
        <WFHRequestForm />
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title={t("cardRequests")}>
          {errored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "wfh" })} backHref="/hr/workforce" />
            </div>
          ) : (
            <DataTable<Row>
            columns={COLUMNS}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🏠"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
          )}
        </Card>
      </div>
    </main>
  );
}
