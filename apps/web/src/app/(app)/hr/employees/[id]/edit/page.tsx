import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../_components/ds";
import { getEmployeeById } from "../../../../../_data/loaders";
import { EditEmployeeForm } from "./EditEmployeeForm";
import { getTranslations } from "next-intl/server";

export default async function EditEmployeePage({
  params,
}: {
  params: { id: string };
}) {
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
