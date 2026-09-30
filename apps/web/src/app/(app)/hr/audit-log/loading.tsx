import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonTable } from "@/app/_components/ds";

/**
 * GAP-HR-AUDIT-LOG-09: this used to be a single unstyled skeleton box with no
 * header or table shape (unlike hr/loading.tsx's SkeletonTable pattern) --
 * a throttled load flashed a bare grey rectangle, then jumped to a full page
 * with header + filter form + table, a visible layout shift.
 */
export default async function Loading() {
  const t = await getTranslations("hrAuditLog");
  return (
    <div className="page-main wrap" aria-busy="true">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <SkeletonTable rows={8} />
    </div>
  );
}
