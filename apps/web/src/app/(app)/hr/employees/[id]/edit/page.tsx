import { notFound } from "next/navigation";
import { PageHeader, RefreshErrorState } from "../../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getEmployeeById } from "../../../../../_data/loaders";
import { EditEmployeeForm } from "./EditEmployeeForm";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { EMPLOYEE_ADMIN_ROLES } from "@/lib/auth/workRoles";

/**
 * Mirrors services/hrms-service/src/modules/employee/routes.ts's HR_ROLES
 * guard on PATCH /v1/hrms/employees/:id exactly.
 *
 * Checked before fetching the employee record: an unauthorized role gets an
 * honest permission message instead of a live-but-doomed edit form, and
 * this route doesn't leak whether a given employee id exists to a caller
 * who couldn't act on the record either way.
 */

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

  const { data: employee, source, status } = await getEmployeeById(params.id);
  const t = await getTranslations("employeeEdit");

  // SF-02: only a real 404 is "not found"; other failures are load errors.
  if (source === "error" && status === 404) notFound();
  if (!employee) {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("pageTitle")} back={`/hr/employees/${params.id}`} />
        <RefreshErrorState error={toHumanError("load", { area: "employee" })} backHref={`/hr/employees/${params.id}`} />
      </div>
    );
  }

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back={`/hr/employees/${params.id}`}
        backLabel={employee.name}
      />
      <EditEmployeeForm employee={employee} />
    </div>
  );
}
