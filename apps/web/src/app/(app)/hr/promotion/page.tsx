import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PromoteWithApproval } from "./PromoteWithApproval";
import { PromotionCard, type PromotionRow } from "./_components/PromotionCard";
import { HR_STAFF_ROLES } from "@/lib/auth/workRoles";

// GAP-HR-PROMOTION-03: matches employee/routes.ts's own HR_ROLES gate on
// POST .../promotion/submit-approval exactly -- keep in sync if that ever
// changes. The wizard button used to render for every /hr viewer (hr/
// layout.tsx admits manager and employee too), so an employee or manager
// could fill in two steps of a confidential eFile action before hitting a
// raw 403 on submit.
const PROMOTION_SUBMIT_ROLES = HR_STAFF_ROLES;

// GAP-HR-PROMOTION-01: GET /v1/hrms/promotions (lifecycle/m7-list-routes.ts) is
// the page's ONE source. It returns the enriched row the table columns are
// keyed on (employee, department, fromGrade, toGrade, orderNo ...) and
// newBasicMinor as a string. This page used to read the raw
// /hrms/lifecycle/promotions list first and only fell back to this one when
// that came back empty -- so as soon as a promotion existed, the table's
// employee / grade / order-no cells were blank. The route caps at 500 rows
// and reports `hasMore`; it is surfaced below instead of being dropped.
type PromotionData = { rows: PromotionRow[]; hasMore: boolean };

async function getData(): Promise<LoaderResult<PromotionData>> {
  return fetchJson<unknown, PromotionData>("/api/v1/hrms/promotions", { rows: [], hasMore: false }, {
    telemetryKey: "hr.promotion",
    mapResponse: (p) => {
      const body = p as { data?: PromotionRow[]; hasMore?: boolean } | PromotionRow[] | null;
      const arr = Array.isArray(body) ? body : body?.data;
      if (!Array.isArray(arr)) return null;
      return { rows: arr, hasMore: Array.isArray(body) ? false : Boolean(body?.hasMore) };
    },
  });
}

export default async function PromotionPage() {
  const t = await getTranslations("promotion");
  const { data, source, status, errorMessage } = await getData();
  const { rows: items, hasMore } = data;
  const canPromote = getSessionRoles().some((r) => PROMOTION_SUBMIT_ROLES.includes(r));

  // GAP-HR-PROMOTION-02: pending_approval/pending_effective previously
  // landed in none of these buckets (only Total counted them) -- the real
  // eOffice flow (promotion-eoffice-consumer.ts) produces pending ->
  // pending_approval -> pending_effective -> completed/cancelled, so most
  // real rows were invisible to every counter except Total. dept_approved/
  // hr_approved/finance_approved/approved are legacy pre-eOffice statuses,
  // kept so old rows still count correctly.
  const approved   = items.filter((i) => ["approved", "signed", "completed", "finance_approved"].includes(i.status)).length;
  const pending    = items.filter((i) => ["pending", "pending_approval"].includes(i.status)).length;
  const inApproval = items.filter((i) => ["dept_approved", "hr_approved", "pending_effective"].includes(i.status)).length;
  const completed  = items.filter((i) => ["signed", "completed"].includes(i.status)).length;
  const cancelled  = items.filter((i) => i.status === "cancelled").length;

  const tableColumns: { key: keyof PromotionRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",     label: t("colEmployee")       },
    { key: "department",   label: t("colDepartment")     },
    { key: "fromGrade",    label: t("colFromGrade")     },
    { key: "toGrade",      label: t("colToGrade")       },
    { key: "effectiveDate",label: t("colEffectiveDate") },
    { key: "orderNo",      label: t("colOrderNo")      },
    { key: "status",       label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel={t("backLabel")}
        actions={canPromote ? <PromoteWithApproval /> : undefined}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="⬆️" iconBg="var(--goodbg)"  label={t("statTotal")} value={items.length} />
        <StatCard icon="✅" iconBg="var(--infobg)"  label={t("statApprovedSigned")} value={approved} />
        <StatCard icon="🔄" iconBg="var(--primary-soft)"  label={t("statInApproval")}       value={inApproval} />
        <StatCard icon="⏳" iconBg="var(--warnbg)"  label={t("statInitiated")}         value={pending} />
        <StatCard icon="📋" iconBg="var(--bg)"  label={t("statSignedIssued")}   value={completed} />
        <StatCard icon="🚫" iconBg="var(--badbg)"  label={t("statCancelled")}     value={cancelled} />
      </StatGrid>

      {hasMore && (
        <p role="note" style={{ margin: "0 0 14px", fontSize: "0.8125rem", color: "var(--warn)" }}>
          {t("hasMoreNotice")}
        </p>
      )}

      {/* Card grid view */}
      {items.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ink2)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 14px" }}>
            {t("ordersHeading")}
          </h2>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))" }}>
            {items.map((p) => (
              <PromotionCard key={p.id} promotion={p} />
            ))}
          </div>
        </div>
      )}

      {/* Table view */}
      <Card title={t("tableViewTitle")}>
        {source === "error" ? (
          <LoadErrorState result={{ status, errorMessage }} area="promotions" backHref="/hr" />
        ) : (
          <DataTable<PromotionRow>
            columns={tableColumns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📈"
            emptyTitle={t("noOrdersTitle")}
            emptyMessage={t("noOrdersMessage")}
          />
        )}
      </Card>
    </div>
  );
}
