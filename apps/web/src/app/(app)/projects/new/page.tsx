import { PageHeader } from "../../../_components/ds";
import { CreateProjectForm, type SchemeOption } from "./CreateProjectForm";
import { getSchemes } from "../../../_data/loaders";
import { requireAnyRole, PROJECT_WRITE_ROLES } from "@/lib/auth/roleGuard";

export default async function NewProjectPage() {
  // GAP-PROJECTS-NEW-03: web role gate (defence-in-depth). project-service
  // already enforces PROJ_ROLES on POST /v1/projects (requireRole), so this
  // only avoids offering a form whose submit is guaranteed to 403. A user
  // without a project-write role is redirected to /projects.
  requireAnyRole(PROJECT_WRITE_ROLES, "/projects");

  // GAP-PROJECTS-NEW-01: load schemes so the form can offer a scheme picker,
  // letting a created project be linked to its scheme (previously impossible).
  const { data: schemes } = await getSchemes();
  const schemeOptions: SchemeOption[] = (schemes ?? []).map((s) => ({
    id: s.id,
    schemeCode: s.schemeCode,
    name: s.name,
  }));

  return (
    <div className="wrap">
      <PageHeader
        title="New Project"
        subtitle="Register a new government project with budget and timeline."
        back="/projects/list"
      />
      <CreateProjectForm schemes={schemeOptions} />
    </div>
  );
}
