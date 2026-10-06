"use client";

/**
 * GAP-WORKFLOW-DEFINITIONS-01 — client templates table. Each template row gets
 * a "Use template" action that clones the template into the caller's tenant as
 * a new editable draft (POST /v1/workflow/templates/:id/clone — ADMIN_ROLES +
 * audited server-side; the clone is processed asynchronously, so on success we
 * refresh the definitions list where the new draft appears). Replaces the dead
 * "Clone a template…" copy that promised an action the page never offered.
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, ActionButton } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";

export interface TemplateRow {
  id: string;
  name: string;
  code?: string;
  version?: number;
  [key: string]: unknown;
}

function cloneError(): string {
  const human = toHumanError("save", { area: "template" });
  return `${human.what} ${human.next}`;
}

export function TemplatesTable({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  const clone = useCallback(async (id: string) => {
    const res = await fetch(`/api/proxy/v1/workflow/templates/${encodeURIComponent(id)}/clone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!(res.ok || res.status === 202)) throw new Error(cloneError());
  }, []);

  type Row = TemplateRow & Record<string, unknown>;
  const rows: Row[] = templates as Row[];

  return (
    <>
      <div aria-live="polite" role="status" className="sr-only">{notice ?? ""}</div>
      {notice ? (
        <p className="pill good" style={{ marginBottom: 10 }}>{notice}</p>
      ) : null}
      <DataTable<Row>
        columns={[
          { key: "name", label: "Template" },
          { key: "code", label: "Code", render: (r) => (r.code ? String(r.code) : "—") },
          { key: "version", label: "Version", align: "right", render: (r) => (r.version != null ? String(r.version) : "—") },
          {
            key: "id",
            label: "Action",
            align: "right",
            sortable: false,
            csvExclude: true,
            render: (r) => (
              <ActionButton
                label="Use template"
                className="btn ghost sm"
                confirmTitle={`Use "${r.name}" as a starting point?`}
                confirmDescription="This copies the template into your tenant as a new editable draft workflow. It does not change the template or any running workflows. The copy is recorded in the audit log."
                confirmLabel="Create draft"
                onConfirm={async () => {
                  await clone(r.id);
                }}
                onSuccess={() => {
                  setNotice(`Draft created from "${r.name}". It will appear in your approval workflows shortly.`);
                  router.refresh();
                }}
              />
            ),
          },
        ]}
        rows={rows}
        sortable
      />
    </>
  );
}
