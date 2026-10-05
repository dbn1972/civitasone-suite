import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { GrievanceCategoriesEditor } from "../../../_components/crm/GrievanceCategoriesEditor";

/** GAP-CRM-GRIEVANCES-NEW-03 — grievance-category master admin. */
export default async function Page() {
  const t = await getTranslations("crmGrievanceCategories");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        backLabel={t("backLabel")}
      />
      <GrievanceCategoriesEditor />
    </>
  );
}
