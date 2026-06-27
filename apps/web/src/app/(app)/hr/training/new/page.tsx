import { PageHeader } from "../../../../_components/ds";
import { NewTrainingForm } from "./NewTrainingForm";

export default function NewTrainingPage() {
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New Training Program"
        subtitle="Schedule a new capacity building initiative."
        back="/hr/training"
      />
      <NewTrainingForm />
    </main>
  );
}
