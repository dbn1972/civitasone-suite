import { notFound } from "next/navigation";
import { PageHeader, Card } from "../../../../../_components/ds";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { fetchJson } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";
import { EmployeeTypeForm, type EmployeeTypeFormValues } from "../../_components/EmployeeTypeForm";

const EMPLOYEE_TYPE_ADMIN_ROLES = ["hr_admin", "super_admin", "admin"];

type EmpType = EmployeeTypeFormValues & { id: string };

async function getType(id: string): Promise<EmpType | null> {
  // The list route is the only one this module exposes (no GET /:id) --
  // fetch the tenant's full list and find the row, same cost as the list
  // page itself already pays and consistent with a tenant type master
  // normally being a few dozen rows (see GAP-HR-EMPLOYEE-TYPES-06's own
  // "no backend limit/offset" note).
  const r = await fetchJson<unknown, EmpType[]>("/api/v1/hrms/employee-types", [], {
    telemetryKey: "config.employee_types",
    mapResponse: (p) => (p as { data: EmpType[] })?.data ?? null,
  });
  return (r.data ?? []).find((t) => t.id === id) ?? null;
}

export default async function EditEmployeeTypePage({ params }: { params: { id: string } }) {
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

  const type = await getType(params.id);
  if (!type) notFound();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("formTitleEdit", { name: type.name })} subtitle={t("formSubtitleEdit")} back="/hr/employee-types" backLabel={t("title")} />
      <Card padding>
        <EmployeeTypeForm mode="edit" id={type.id} initial={type} />
      </Card>
    </div>
  );
}
