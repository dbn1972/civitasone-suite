import { PageHeader } from "../../../_components/ds";
import { CreateProjectForm } from "./CreateProjectForm";

export default function NewProjectPage() {
  return (
    <div className="wrap">
      <PageHeader
        title="New Project"
        subtitle="Register a new government project with budget and timeline."
        back="/projects/list"
      />
      <CreateProjectForm />
    </div>
  );
}
