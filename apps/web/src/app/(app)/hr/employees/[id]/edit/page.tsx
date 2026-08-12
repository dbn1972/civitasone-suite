import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../_components/ds";
import { getEmployeeById } from "../../../../../_data/loaders";
import { EditEmployeeForm } from "./EditEmployeeForm";

export default async function EditEmployeePage({
  params,
}: {
  params: { id: string };
}) {
  const { data: employee } = await getEmployeeById(params.id);

  if (!employee) {
    notFound();
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Edit Employee"
        subtitle="Update employee contact and assignment details."
        back={`/hr/employees/${params.id}`}
        backLabel={employee.name}
      />
      <EditEmployeeForm employee={employee} />
    </main>
  );
}
