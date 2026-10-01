import { PageHeader, Card } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";
import { EmployeeTypeForm } from "../_components/EmployeeTypeForm";

const EMPLOYEE_TYPE_ADMIN_ROLES = ["hr_admin", "super_admin", "admin"];

export default async function NewEmployeeTypePage() {
  const t = await getTranslations("employeeTypes");
  const roles = getSessionRoles();
  const canManage = roles.some((r: string) => EMPLOYEE_TYPE_ADMIN_ROLES.includes(r));

  if (!canManage) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="employee types" requiredRoles={EMPLOYEE_TYPE_ADMIN_ROLES} backHref="/hr/employee-types" backLabel={t("title")} />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("formTitleNew")} subtitle={t("formSubtitleNew")} back="/hr/employee-types" backLabel={t("title")} />
      <Card padding>
        <EmployeeTypeForm mode="create" />
      </Card>
    </div>
  );
}
