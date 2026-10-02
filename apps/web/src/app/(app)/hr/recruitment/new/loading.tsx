import { getTranslations } from "next-intl/server";
import { PageHeader, Card, SkeletonBar } from "../../../../_components/ds";

// GAP-RECRUITMENT-NEW-07: same heading, subtitle and back link as page.tsx (no layout jump, one name
// for the screen), and a form-shaped skeleton (label + input rows) instead of a dashboard shape.
export default async function Loading() {
  const t = await getTranslations("recruitmentNewJob");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/recruitment" backLabel="Back to Recruitment"
      />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i}>
              <SkeletonBar w={120} h={12} style={{ marginBottom: 8 }} />
              <SkeletonBar h={44} style={{ borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
