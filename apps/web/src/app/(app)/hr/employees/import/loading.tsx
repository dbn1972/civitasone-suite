import { Card, PageHeader, SkeletonBar, SkeletonRegion, SkeletonRow } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-EMPLOYEES-IMPORT-07: this used to render a hero block, four KPI-style
 * tiles and a table block -- a dashboard shape for what is really a form page.
 * The loaded page is a header plus TWO cards (the CSV template table, then the
 * upload form), so the skeleton is exactly that: a real header and two card
 * skeletons -- a six-row table, then a file input with its button. No KPI tiles.
 */
export default async function Loading() {
  const t = await getTranslations("employeeImport");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/employees" backLabel={t("backLabel")} />
      <SkeletonRegion live>
        <div style={{ display: "grid", gap: 16 }}>
          <div data-testid="import-skeleton-card">
            <Card padding>
              <SkeletonBar w={160} h={18} style={{ marginBottom: 12 }} />
              <SkeletonBar w="60%" h={13} style={{ marginBottom: 16 }} />
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} data-testid="import-skeleton-row">
                  <SkeletonRow />
                </div>
              ))}
            </Card>
          </div>
          <div data-testid="import-skeleton-card">
            <Card padding>
              <SkeletonBar w={140} h={18} style={{ marginBottom: 12 }} />
              <SkeletonBar h={44} style={{ borderRadius: 8, marginBottom: 8 }} />
              <SkeletonBar w="45%" h={12} style={{ marginBottom: 16 }} />
              <SkeletonBar w={160} h={44} style={{ borderRadius: 8 }} />
            </Card>
          </div>
        </div>
      </SkeletonRegion>
    </div>
  );
}
