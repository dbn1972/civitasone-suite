import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";

type RawRow = {
  id: string;
  complainantId: string;
  respondentId?: string;
  summary: string;
  filedAt: string;
  status: string;
  confidential: boolean;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/icc/complaints", [], {
    telemetryKey: "hr.icc",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function IccPage() {
  const t = await getTranslations("icc");
  const { data: rawItems, source } = await getData();
  const items: Row[] = rawItems.map((r) => ({ ...r, caseRef: "ICC/" + r.id.slice(0, 8).toUpperCase() }));

  const filed = items.filter((i) => i.status === "filed").length;
  const inquiry = items.filter((i) => i.status === "inquiry" || i.status === "under_inquiry").length;
  const closed = items.filter((i) => ["closed", "disposed", "withdrawn"].includes(i.status)).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: t("colCaseRef") },
    { key: "summary", label: t("colSummary") },
    { key: "filedAt", label: t("colFiledDate") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="⚖️" iconBg="#e6f0ff" label={t("statTotalComplaintsLabel")} value={items.length} />
        <StatCard icon="🔔" iconBg="#fffbe6" label={t("statFiledLabel")} value={filed} />
        <StatCard icon="🔍" iconBg="#fff1f0" label={t("statUnderInquiryLabel")} value={inquiry} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statDisposedLabel")} value={closed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="⚖️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}
