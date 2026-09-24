import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";

// Matches the backend role gate on GET /v1/hrms/id-cards (services/hrms-service/
// src/modules/id-cards/routes.ts) -- this page had no client-side gate at all,
// so any authenticated user could reach a UI showing org-wide holder photo,
// card number, department, and access_zones even though the backend now
// (separately) rejects the underlying fetch for anyone outside this list.
const ID_CARDS_ROLES = ["hr_admin", "security_admin", "super_admin"];

type Row = {
  id: string;
  holder_name: string;
  designation: string;
  department: string;
  employee_code: string;
  card_type: string;
  card_number: string;
  vendor_name: string;
  valid_until: string;
  status: string;
  verification_count: number;
  issued_by_name: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/id-cards", [], {
    telemetryKey: "hr.id-cards",
    mapResponse: (p) => {
      const arr = (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function IdCardsPage() {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => ID_CARDS_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="ID cards" requiredRoles={ID_CARDS_ROLES} />;
  }

  const t = await getTranslations("idCards");
  const { data: items, source } = await getData();

  const errored = source === "error";
  const active      = items.filter((i) => i.status === "active").length;
  const suspended   = items.filter((i) => i.status === "suspended").length;
  const vendor      = items.filter((i) => i.card_type === "vendor_staff" || i.card_type === "project_team").length;

  const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "card_number",        label: t("colCardNumber") },
    { key: "holder_name",        label: t("colHolder") },
    { key: "designation",        label: t("colDesignation") },
    { key: "department",         label: t("colDepartment") },
    { key: "card_type",          label: t("colType") },
    { key: "valid_until",        label: t("colValidUntil") },
    { key: "verification_count", label: t("colVerifications") },
    { key: "status",             label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="🆔" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalCardsLabel")}    value={errored ? "—" : items.length} />
        <StatCard icon="✅"          iconBg="var(--goodbg, #e6f7f0)" label={t("statActiveLabel")}         value={errored ? "—" : active} />
        <StatCard icon="⏸️"          iconBg="var(--warnbg, #fffbe6)" label={t("statSuspendedLabel")}      value={errored ? "—" : suspended} />
        <StatCard icon="👥"          iconBg="var(--bg, #f5f5f5)" label={t("statVendorProjectLabel")} value={errored ? "—" : vendor} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={20}
          emptyIcon="🆔"
          emptyTitle={t("emptyTitle")}
          // HR-A deep-verify finding: this pointed users at a card management
          // portal that does not exist anywhere in the app (repo-wide grep
          // confirms zero matches beyond this string) -- this page is a
          // read-only list (no issue/suspend/revoke UI at all, though the
          // backend fully supports all of it). Removed the dead reference
          // rather than invent a destination.
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </div>
  );
}
