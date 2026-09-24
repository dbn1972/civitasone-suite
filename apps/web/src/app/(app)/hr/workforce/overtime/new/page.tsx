import { getTranslations } from "next-intl/server";
import { PageHeader, Card } from "../../../../../_components/ds";
import { OvertimeClaimForm } from "../../../_components/OvertimeClaimForm";

/**
 * OvertimeNewPage — submit a new overtime claim via OvertimeClaimForm.
 * CCS (Leave) Rules: OT compensation as cash or comp-off.
 */
export default async function OvertimeNewPage() {
  const t = await getTranslations("workforceOvertimeNew");
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/workforce/overtime" backLabel="Back to Overtime"
      />
      <div style={{ maxWidth: 540, marginTop: 20 }}>
        <Card title={t("cardTitle")}>
          <OvertimeClaimForm />
        </Card>
      </div>
    </main>
  );
}
