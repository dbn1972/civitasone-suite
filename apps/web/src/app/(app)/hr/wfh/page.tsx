import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type Row = {
  id: string;
  employee: string;
  department: string;
  fromDate: string;
  toDate: string;
  days: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/wfh-requests", [], {
    telemetryKey: "hr.wfh-requests",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function WfhPage() {
  const t = await getTranslations("wfhRequests");
  const { data: items, source } = await getData();

  const errored = source === "error";
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: t("colEmployee") },
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
        back="/hr" backLabel="Back to HR"
        actions={<Link href="/hr/workforce/wfh" className="btn primary">{t("newRequestBtn")}</Link>}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏠" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApprovedLabel")} value={errored ? "—" : approved} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? "—" : pending} />
        <StatCard icon="❌" iconBg="var(--badbg, #fff0f0)" label={t("statRejectedLabel")} value={errored ? "—" : rejected} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "WFH requests" })} backHref="/hr" />
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏠"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
          emptyAction={<Link href="/hr/workforce/wfh" className="btn primary">{t("newRequestBtn")}</Link>}
        />
        )}
      </Card>
    </main>
  );
}
