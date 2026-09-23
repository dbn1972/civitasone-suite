import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../_components/ds";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getEmployeeById } from "../../../../../_data/loaders";
import { EditEmployeeForm } from "./EditEmployeeForm";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * Mirrors services/hrms-service/src/modules/employee/routes.ts's HR_ROLES
 * guard on PATCH /v1/hrms/employees/:id exactly.
 *
 * Checked before fetching the employee record: an unauthorized role gets an
 * honest permission message instead of a live-but-doomed edit form, and
 * this route doesn't leak whether a given employee id exists to a caller
 * who couldn't act on the record either way.
 */
const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function EditEmployeePage({
  params,
}: {
  params: { id: string };
}) {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => EMPLOYEE_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="editing employee details" requiredRoles={EMPLOYEE_ADMIN_ROLES} />;
  }

  const { data: employee } = await getEmployeeById(params.id);
  const t = await getTranslations("employeeEdit");

  if (!employee) {
    notFound();
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back={`/hr/employees/${params.id}`}
        backLabel={employee.name}
      />
      <EditEmployeeForm employee={employee} />
    </main>
  );
}
