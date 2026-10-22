"use client";

import { DataTable } from "@/app/_components/ds";
import { MaskedReveal } from "@/app/_components/ds/MaskedReveal";

export interface VigilanceRow extends Record<string, unknown> {
  id: string;
  caseRef: string;
  employee: string;
  department: string;
  /** True when the case has charge text to reveal (the text itself never reaches this component). */
  hasCharges: boolean;
  inquiryOfficer: string;
  nextHearing: string;
  status: string;
}

interface Props {
  rows: VigilanceRow[];
  labels: {
    caseRef: string;
    employee: string;
    department: string;
    charges: string;
    inquiryOfficer: string;
    inquiryOfficerAppointed: string;
    status: string;
    noCharges: string;
    emptyTitle: string;
    emptyMessage: string;
    caption: string;
  };
}

/** Shown until a reveal succeeds. Fixed-width glyphs: leaks neither the text nor its length. */
const MASKED_CHARGES = "••••••••";

/**
 * Client wrapper for the vigilance register (GAP-HR-VIGILANCE-01 / -05).
 *
 *  - The charge summary never reaches this component: the page asks the backend
 *    for the list with `maskCharges=true`, so the row carries only `hasCharges`.
 *    The clear text exists only after an audited, reason-bearing reveal
 *    (POST /v1/hrms/vigilance/:id/charges/reveal), which re-masks itself.
 *    `render` and `rowHref` are functions, which a Server Component cannot pass
 *    to a Client Component -- hence this wrapper.
 *  - Rows open the shared disciplinary case page with `?from=vigilance`, so
 *    its Back link returns here instead of dropping out to the full register.
 *
 * The table's own text filter is deliberately off: it could only search the
 * rows already loaded. Search and status filtering are server-side (the form on
 * the page), across every case.
 */
export function VigilanceTable({ rows, labels }: Props) {
  return (
    <DataTable<VigilanceRow>
      columns={[
        { key: "caseRef", label: labels.caseRef },
        { key: "employee", label: labels.employee },
        { key: "department", label: labels.department },
        {
          key: "hasCharges",
          label: labels.charges,
          sortable: false,
          render: (r) =>
            r.hasCharges ? (
              // The whole row is a click target that opens the case page (DataTable's
              // row link). A click on Reveal -- or inside its reason dialog, whose
              // React events bubble through this tree even though the dialog is
              // portalled -- must NOT also navigate, so it stops here.
              <div role="presentation" onClick={(e) => e.stopPropagation()}>
                <MaskedReveal
                  maskedText={MASKED_CHARGES}
                  resourceType="disciplinary_case"
                  resourceId={r.id}
                  field="charges_summary"
                  label={labels.charges}
                  revealPath={`v1/hrms/vigilance/${encodeURIComponent(r.id)}/charges/reveal`}
                />
              </div>
            ) : (
              <span>{labels.noCharges}</span>
            ),
          csvExclude: true,
        },
        { key: "inquiryOfficer", label: labels.inquiryOfficer },
        { key: "nextHearing", label: labels.inquiryOfficerAppointed, cellType: "date" },
        { key: "status", label: labels.status, cellType: "status" },
      ]}
      rows={rows}
      rowHref={(r) => `/hr/disciplinary/${encodeURIComponent(r.id)}?from=vigilance`}
      sortable
      pageSize={15}
      caption={labels.caption}
      emptyIcon="⚖️"
      emptyTitle={labels.emptyTitle}
      emptyMessage={labels.emptyMessage}
    />
  );
}
