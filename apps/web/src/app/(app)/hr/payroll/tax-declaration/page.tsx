import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PageHeader } from "../../../../_components/ds";
import { TaxDeclarationForm } from "./TaxDeclarationForm";

export const metadata = {
  title: "Tax Declaration",
  description: "Submit self-declared income tax investments (80C/80D/HRA)",
};

export default async function TaxDeclarationPage() {
  const t = await getTranslations("taxDeclaration");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
        backLabel={t("errorBackLabel")}
        actions={<Link href="/hr/payroll/income-tax">{t("viewIncomeTaxLink")}</Link>}
      />
      <TaxDeclarationForm />
    </div>
  );
}
