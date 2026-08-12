"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";
import { AddLocationForm } from "./AddLocationForm";

export default function NewLocationPage() {
  const router = useRouter();
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Add Location"
        subtitle="Register an office, branch, or facility location."
        back="/hr/locations"
        backLabel="Locations"
      />
      <AddLocationForm
        onCancel={() => { router.push("/hr/locations"); }}
        onSuccess={() => {
          router.refresh();
          setTimeout(() => { router.push("/hr/locations"); }, 1500);
        }}
      />
    </main>
  );
}
