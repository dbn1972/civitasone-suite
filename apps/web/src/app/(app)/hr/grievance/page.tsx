import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type RawRow = {
  id: string;
  employee: string;
  department: string;
  category: string;
  filedDate: string;
  assignedTo: string;
  description: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/grievances", [], {
    telemetryKey: "hr.grievances",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export default async function GrievancePage() {
  const t = await getTranslations("grievance");
  const { data: rawItems, source } = await getData();
  const errored = source === "error";
  const items: Row[] = rawItems.map((r) => ({ ...r, caseRef: shortId(r.id) }));

  const opened = items.filter((i) => i.status === "opened" || i.status === "registered").length;
  const inquiry = items.filter((i) => i.status === "under_inquiry" || i.status === "in_progress").length;
  const closed = items.filter((i) => i.status === "closed" || i.status === "disposed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: t("colRefNo") },
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "category", label: t("colGrievance") },
    { key: "filedDate", label: t("colFiledDate") },
    { key: "assignedTo", label: t("colHrOfficer") },
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
        <StatCard icon="📋" iconBg="#e6f0ff" label={t("statTotalCasesLabel")} value={errored ? null : items.length} />
        <StatCard icon="🔴" iconBg="#fff1f0" label={t("statOpenLabel")} value={errored ? null : opened} />
        <StatCard icon="🔍" iconBg="#fffbe6" label={t("statUnderInquiryLabel")} value={errored ? null : inquiry} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statDisposedLabel")} value={errored ? null : closed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "grievances" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📋"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </main>
  );
}
