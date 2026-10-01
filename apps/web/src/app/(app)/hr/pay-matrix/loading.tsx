import { PageHeader, Card } from "../../../_components/ds";
import { SkeletonTable } from "../../../_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

// GAP-HR-PAY-MATRIX-05: this used to render raw Tailwind utility classes
// (`animate-pulse h-48 bg-slate-100`) instead of the shared ds Skeleton, and
// was missing the `page-main wrap` container the loaded page renders inside
// -- so padding/width differed and the layout shifted once data arrived.
export default async function PayMatrixLoading() {
  const t = await getTranslations("payMatrix");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("loadingSubtitle")} back="/hr" backLabel={t("backToHr")} />
      <Card title={t("loadingCardTitle")}>
        <SkeletonTable rows={10} />
      </Card>
    </div>
  );
}
