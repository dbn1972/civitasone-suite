import { PageHeader } from "../../../../_components/ds";
import { NewTemplateForm } from "./NewTemplateForm";

export const metadata = { title: "New JD Template — HR" };

export default function NewTemplatePage() {
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New JD Template"
        subtitle="Create a reusable job description template."
        back="/hr/jd-templates"
      />
      <NewTemplateForm />
    </main>
  );
}
