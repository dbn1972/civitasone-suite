import { getTranslations } from "next-intl/server";
import { PageHeader, Card, SkeletonBar } from "../../../../_components/ds";

export default async function Loading() {
  const t = await getTranslations("recruitmentRequisitions");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} back="/hr/recruitment" backLabel="Back to Recruitment" />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => <SkeletonBar key={i} h={44} style={{ borderRadius: 8 }} />)}
        </div>
      </Card>
    </div>
  );
}
