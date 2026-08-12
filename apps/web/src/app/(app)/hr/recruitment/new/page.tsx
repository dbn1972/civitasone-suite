import { PageHeader, Card } from "../../../../_components/ds";
import { NewJobOpeningForm } from "./NewJobOpeningForm";

export default function NewJobOpeningPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="New Job Opening"
        subtitle="Post a new vacancy for recruitment."
        back="/hr/recruitment"
      />
      <Card>
        <NewJobOpeningForm />
      </Card>
    </main>
  );
}
