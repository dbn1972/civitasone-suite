import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";

const RTI_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type Row = {
  id: string;
  referenceNo: string;
  applicantName: string;
  subject: string;
  receivedDate: string;
  dueDate: string;
  status: string;
  overdue: boolean;
  daysToDue: number;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/rti/requests", [], {
    telemetryKey: "hr.rti",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function RtiPage() {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => RTI_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="RTI requests" requiredRoles={RTI_ROLES} />;
  }

  const t = await getTranslations("rtiRequests");
  const { data: items, source } = await getData();

  const pending = items.filter((i) => i.status === "filed" || i.status === "assigned").length;
  const overdue = items.filter((i) => i.overdue).length;
  const disposed = items.filter((i) => i.status === "responded" || i.status === "closed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "referenceNo", label: t("colReferenceNo") },
    { key: "applicantName", label: t("colApplicant") },
    { key: "subject", label: t("colSubject") },
    { key: "receivedDate", label: t("colReceived") },
    { key: "dueDate", label: t("colDueDate") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="📂" iconBg="#e6f0ff" label={t("statTotalLabel")} value={items.length} />
        <StatCard icon="🔔" iconBg="#fffbe6" label={t("statPendingLabel")} value={pending} />
        <StatCard icon="🔴" iconBg="#fff1f0" label={t("statOverdueLabel")} value={overdue} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statDisposedLabel")} value={disposed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📂"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}
