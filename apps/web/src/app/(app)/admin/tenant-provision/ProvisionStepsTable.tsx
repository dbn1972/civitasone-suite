"use client";
import { DataTable } from "@/app/_components/ds";

export type ProvisionStep = { step: number; name: string; description: string; required: string; [k: string]: unknown };

/**
 * GAP-ADMIN-TENANT-PROVISION-04/-05: Required vs Optional is a pill so it can be
 * scanned (no status-map fallback to blue), and the table is NOT sortable --
 * these rows are a fixed, ordered procedure (step 1-8).
 */
export function ProvisionStepsTable({ steps }: { steps: ProvisionStep[] }) {
  return (
    <DataTable<ProvisionStep>
      columns={[
        { key: "step", label: "Step", align: "center" },
        { key: "name", label: "Step Name" },
        { key: "description", label: "Description" },
        {
          key: "required",
          label: "Required",
          render: (r) => (r.required === "Yes" ? <span className="pill good">Required</span> : <span className="pill mut">Optional</span>),
        },
      ]}
      rows={steps}
      emptyIcon="🚀"
      emptyTitle="No steps"
      emptyMessage="Provisioning steps not configured."
    />
  );
}
