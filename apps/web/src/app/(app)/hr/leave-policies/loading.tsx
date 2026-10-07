import { PageHeader, SkeletonTable } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-LEAVE-POLICIES-06: this used hard-coded Tailwind slate classes
 * (bg-slate-50/bg-slate-200) — an untokenised, one-off loading treatment
 * that doesn't match the shimmer/SkeletonTable every other HR loading.tsx
 * uses (e.g. hr/leave/loading.tsx). Rebuilt on the same PageHeader +
 * SkeletonTable shell.
 */
export default async function HRLeavePoliciesLoading() {
  const t = await getTranslations("leavePolicies");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <SkeletonTable rows={6} />
    </div>
  );
}
