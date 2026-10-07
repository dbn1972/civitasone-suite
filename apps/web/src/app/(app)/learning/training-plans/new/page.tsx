import { PageHeader } from "@/app/_components/ds";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getDepartments } from "../../_data";
import { CreatePlanForm } from "./CreatePlanForm";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function Page() {
  const roles = getSessionRoles();
  const isHr = roles.some((r) => HR_ROLES.includes(r));

  // Server enforces HR_ROLES on POST too; this is the matching web gate.
  if (!isHr) {
    return <PermissionDenied module="creating a training plan" requiredRoles={HR_ROLES} backHref="/learning/training-plans" />;
  }

  const { data: departments } = await getDepartments();

  return (
    <>
      <PageHeader title="New Training Plan" subtitle="Create an annual plan for a department or role." back="/learning/training-plans" />
      <div className="card">
        <CreatePlanForm departments={departments.map((d) => ({ id: d.id, name: d.name }))} />
      </div>
    </>
  );
}
