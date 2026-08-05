"use client";
import { DataTable, StatusPill } from "../../../_components/ds";
import type { CRMLeadCaptureForm } from "@civitasone/types";
import { formHealth, originSummary, publicSubmitPath } from "./leadForms";

type Row = {
  id: string;
  name: string;
  health: string;
  submitUrl: string;
  origins: string;
  source: string;
  rate: string;
};

export function LeadFormsTable({ rows }: { rows: CRMLeadCaptureForm[] }) {
  const tableRows: Row[] = rows.map((form) => {
    const health = formHealth(form);
    return {
      id: form.id,
      name: form.name,
      health,
      submitUrl: publicSubmitPath(form.formKey),
      origins: originSummary(form.allowedOrigins),
      source: form.defaultLeadSource ?? "—",
      rate: `${form.maxPerMinute}/min`,
    };
  });

  return (
    <DataTable<Row>
      columns={[
        { key: "name", label: "Form" },
        {
          key: "health",
          label: "Status",
          render: (row) => <StatusPill status={row.health} label={row.health} />,
        },
        { key: "submitUrl", label: "Public submit URL" },
        { key: "origins", label: "Allowed origins" },
        { key: "source", label: "Default source" },
        { key: "rate", label: "Rate limit", align: "right" },
      ]}
      rows={tableRows}
      sortable
      exportable
      exportFilename="crm-lead-capture-forms"
      emptyIcon="🌐"
      emptyTitle="No website forms registered"
      emptyMessage="Register a lead-capture form to mint a public key that landing pages can POST to."
    />
  );
}
