"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";
import { AddDesignationForm } from "./AddDesignationForm";

export default function NewDesignationPage() {
  const router = useRouter();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Add Designation"
        subtitle="Add a new job title or pay level to use across your office."
        back="/hr/designations"
        backLabel="Designations"
      />
      <AddDesignationForm
        onCancel={() => { router.push("/hr/designations"); }}
        onSuccess={() => {
          router.refresh();
          setTimeout(() => { router.push("/hr/designations"); }, 1500);
        }}
      />
    </main>
  );
}
