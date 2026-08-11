import { PageHeader } from "../../../../_components/ds";
import { TaxDeclarationForm } from "./TaxDeclarationForm";

export const metadata = {
  title: "Tax Declaration",
  description: "Submit income tax investment proofs (80C/80D/HRA)",
};

export default function TaxDeclarationPage() {
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader title="Tax Declaration" subtitle="Submit your income tax investment proofs for the current financial year." back="/hr/payroll" />
      <TaxDeclarationForm />
    </main>
  );
}
