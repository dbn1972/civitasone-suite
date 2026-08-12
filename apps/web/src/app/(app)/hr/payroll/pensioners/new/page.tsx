import { PageHeader } from "../../../../../_components/ds";
import { CreatePensionerForm } from "./CreatePensionerForm";

export default function NewPensionerPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Add Pensioner"
        subtitle="Register a new pensioner in the PPO system."
        back="/hr/payroll/pensioners"
      />
      <CreatePensionerForm />
    </main>
  );
}
