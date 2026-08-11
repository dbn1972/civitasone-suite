"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";
import { AddDepartmentForm } from "./AddDepartmentForm";

export default function NewDepartmentPage() {
  const router = useRouter();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Add Department"
        subtitle="Create a new department for your office."
        back="/hr/departments"
        backLabel="Departments"
      />
      <AddDepartmentForm
        onCancel={() => { router.push("/hr/departments"); }}
        onSuccess={() => {
          router.refresh();
          setTimeout(() => { router.push("/hr/departments"); }, 1500);
        }}
      />
    </main>
  );
}
