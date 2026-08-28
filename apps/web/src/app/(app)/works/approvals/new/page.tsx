import { Suspense } from "react";
import { PageHeader } from "@/app/_components/ds";
import { NewAaForm } from "./NewAaForm";

export default function NewAaPage() {
  return (
    <>
      <PageHeader
        title="New Administrative Approval"
        subtitle="Create an Administrative Approval (AA) record for a work."
        back="/works/approvals"
        backLabel="Approvals"
      />
      <Suspense
        fallback={
          <div className="pad" style={{ fontSize: 13, color: "var(--muted)" }}>
            Loading form…
          </div>
        }
      >
        <NewAaForm />
      </Suspense>
    </>
  );
}
