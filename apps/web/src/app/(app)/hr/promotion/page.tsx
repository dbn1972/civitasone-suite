import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { PromoteWithApproval } from "./PromoteWithApproval";
import { PromotionCard, type PromotionRow } from "./_components/PromotionCard";

async function getData(): Promise<LoaderResult<PromotionRow[]>> {
  const r = await fetchJson<unknown, PromotionRow[]>("/api/v1/hrms/lifecycle/promotions", [], {
    telemetryKey: "hr.promotion.lifecycle",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PromotionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  // A genuine fetch error must not be silently papered over by the legacy
  // fallback (UX-013) -- `r.data` is [] on error too, so the old
  // `r.data.length === 0` check alone tried the fallback endpoint on error
  // as if the lifecycle endpoint had simply never had any rows, discarding
  // the real failure. Only fall back when the primary source truly
  // succeeded with zero rows.
  if (r.source === "error") {
    return r;
  }
  if (r.data.length === 0) {
    return fetchJson<unknown, PromotionRow[]>("/api/v1/hrms/promotions", [], {
      telemetryKey: "hr.promotion",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: PromotionRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    });
  }
  return r;
}

export default async function PromotionPage() {
  const t = await getTranslations("promotion");
  const { data: items, source } = await getData();

  const approved  = items.filter((i) => ["approved", "signed", "completed", "finance_approved"].includes(i.status)).length;
  const pending   = items.filter((i) => ["pending"].includes(i.status)).length;
  const inApproval= items.filter((i) => ["dept_approved", "hr_approved"].includes(i.status)).length;
  const completed = items.filter((i) => ["signed", "completed"].includes(i.status)).length;

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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<PromoteWithApproval />}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="⬆️" iconBg="#e6f7f0"  label={t("statTotal")} value={items.length} />
        <StatCard icon="✅" iconBg="#e6f0ff"  label={t("statApprovedSigned")} value={approved} />
        <StatCard icon="🔄" iconBg="#ede9fe"  label={t("statInApproval")}       value={inApproval} />
        <StatCard icon="⏳" iconBg="#fffbe6"  label={t("statInitiated")}         value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5"  label={t("statSignedIssued")}   value={completed} />
      </StatGrid>

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
          <RefreshErrorState error={toHumanError("load", { area: "promotions" })} backHref="/hr" />
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
    </main>
  );
}
