import { getEmployees } from "../../../../_data/loaders";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { NewAppraisalForm } from "./NewAppraisalForm";
import { getTranslations } from "next-intl/server";

export default async function NewAppraisalPage() {
  const t = await getTranslations("appraisalNew");
  const { data: employees, source } = await getEmployees();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/appraisals" backLabel="Back to Appraisals"
      />
      <DataSourceBadge source={source} />
      <NewAppraisalForm employees={employees} />
    </div>
  );
}
