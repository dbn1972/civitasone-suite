import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../../_components/ds";
import { CreatePensionerForm } from "./CreatePensionerForm";

export default async function NewPensionerPage() {
  const t = await getTranslations("pensionersNew");
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/pensioners" backLabel="Back to Pensioners"
      />
      <CreatePensionerForm />
    </main>
  );
}
