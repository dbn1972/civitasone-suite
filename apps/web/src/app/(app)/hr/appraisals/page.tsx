import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { getAppraisals } from "../../../_data/loaders";
import type { AppraisalSummary } from "@civitasone/types";
import { AppraisalCycleProgress } from "./_components/AppraisalCycleProgress";
import { APARRatingDistribution } from "./_components/APARRatingDistribution";
import { getTranslations } from "next-intl/server";

export default async function AppraisalsPage() {
  const t = await getTranslations("appraisals");
  const { data: appraisals, source } = await getAppraisals();

  const total = appraisals.length;
  const pending = appraisals.filter((a) => a.status === "pending").length;
  const inReview = appraisals.filter((a) => a.status === "in_review").length;
  const completed = appraisals.filter((a) => a.status === "completed").length;

  const columns: { key: keyof AppraisalSummary & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "employeeName",    label: t("colEmployee") },
    { key: "department",      label: t("colDepartment") },
    { key: "appraisalPeriod", label: t("colPeriod") },
    { key: "rating",          label: t("colRating"), align: "right" },
    { key: "reviewerName",    label: t("colReviewer") },
    { key: "status",          label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Link href="/hr/appraisals/new" className="btn primary">{t("newAppraisal")}</Link>
        }
      />
      <DataSourceBadge source={source} />

      {total === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon="📊"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
            action={<Link href="/hr/appraisals/new" className="btn primary">{t("startNewCycle")}</Link>}
          />
        </div>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📋" iconBg="var(--bg, #f5f5f5)" label={t("statTotal")}     value={total} />
            <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")}   value={pending} />
            <StatCard icon="🔍" iconBg="var(--infobg, #e6f0ff)" label={t("statInReview")} value={inReview} />
            <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statCompleted")} value={completed} />
          </StatGrid>

          {/* Open-cycle progress (show when there are pending/in-review appraisals) */}
          {(pending > 0 || inReview > 0) && (
            <AppraisalCycleProgress appraisals={appraisals} />
          )}

          {/* APAR rating distribution for closed/completed cycles */}
          {completed > 0 && (
            <APARRatingDistribution appraisals={appraisals} />
          )}

          <Card title={t("recordsTitle")}>
            <DataTable<AppraisalSummary>
              columns={columns}
              rows={appraisals}
              sortable
              filterable
              filterPlaceholder={t("filterPlaceholder")}
              emptyIcon="📊"
              emptyTitle={t("tableEmptyTitle")}
              emptyMessage={t("tableEmptyMessage")}
              pageSize={15}
            />
          </Card>
        </>
      )}
    </main>
  );
}
