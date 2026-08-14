import { Suspense } from "react";
import { PageHeader } from "../../../../_components/ds";
import { NewJobOpeningForm } from "./NewJobOpeningForm";

export default function NewJobOpeningPage() {
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New Job Opening"
        subtitle="Post a new vacancy for recruitment."
        back="/hr/recruitment"
      />
      <Suspense fallback={<div className="text-sm text-slate-500">Loading form…</div>}>
        <NewJobOpeningForm />
      </Suspense>
    </main>
  );
}
