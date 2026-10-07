import { PageHeader, SkeletonBar } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-LEAVE-APPLY-06: was a hand-rolled `.ph` header (not the shared
 * PageHeader) inside `.page-main` with no `wrap` class (page.tsx uses
 * "page-main wrap"), plus a 4-tile stat-card-shaped skeleton the form
 * doesn't have at all — causing a layout shift between loading and loaded.
 * Rebuilt as a single form-shaped skeleton (label+field rows) matching
 * ApplyLeaveForm's actual shape instead.
 */
export default async function Loading() {
  const t = await getTranslations("leaveApply");
  const tc = await getTranslations("common");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("loadingSubtitle")} back="/hr/leave" backLabel={tc("backToLeave")} />
      <section className="mx-auto max-w-2xl">
        <div
          className="space-y-4 rounded-xl border p-6 shadow-sm"
          style={{ background: "var(--panel, #fff)", borderColor: "var(--line, #e2e8f0)", display: "grid", gap: 16 }}
          aria-hidden="true"
        >
          <SkeletonBar h={38} />
          <SkeletonBar h={38} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <SkeletonBar h={38} />
            <SkeletonBar h={38} />
          </div>
          <SkeletonBar h={72} />
          <SkeletonBar h={38} w={160} />
        </div>
      </section>
    </div>
  );
}
