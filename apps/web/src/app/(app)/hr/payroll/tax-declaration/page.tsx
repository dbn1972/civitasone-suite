import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../_components/ds";
import { TaxDeclarationForm } from "./TaxDeclarationForm";

export const metadata = {
  title: "Tax Declaration",
  description: "Submit income tax investment proofs (80C/80D/HRA)",
};

export default async function TaxDeclarationPage() {
  const t = await getTranslations("taxDeclaration");
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel="Back to Payroll" />
      <TaxDeclarationForm />
    </main>
  );
}
