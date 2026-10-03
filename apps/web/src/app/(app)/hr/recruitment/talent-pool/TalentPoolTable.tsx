"use client";

import { DataTable } from "@/app/_components/ds";
import { ContactReveal } from "../_components/ContactReveal";

export type TalentPoolRow = {
  id: string;
  applicantName: string;
  qualification: string | null;
  sourceDisplay: string;
  stage: string;
  href: string;
  /** Masked by the service; never the full address. */
  email: string;
  skillsDisplay: string;
  expDisplay: string;
  appliedDate: string;
};

export type TalentPoolLabels = {
  name: string; email: string; qualification: string; experience: string; skills: string; source: string;
  stage: string; applied: string; filterPlaceholder: string; emptyTitle: string; emptyMessage: string;
};

/**
 * GAP-RECRUITMENT-TALENT-POOL-02: the Email column shows the service-masked address with an audited
 * "Reveal" (hr_admin / super_admin only; the service enforces it again). This is a client component only
 * because the cell needs the reveal control; the rows it receives are plain data.
 *
 * The click / key handlers stop propagation on purpose: a table row is itself a link (click or Enter
 * navigates), and the reveal dialog is rendered inside this cell's React subtree, so without it a click
 * or Enter inside the dialog would navigate away from the page.
 */
export function TalentPoolTable({ rows, labels, canReveal }: { rows: TalentPoolRow[]; labels: TalentPoolLabels; canReveal: boolean }) {
  return (
    <DataTable<TalentPoolRow>
      columns={[
        { key: "applicantName", label: labels.name },
        {
          key: "email",
          label: labels.email,
          render: (row) => (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- guard against the row link; the controls inside are real buttons
            <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <ContactReveal applicationId={row.id} applicantName={row.applicantName} email={row.email} scope="talent_pool" canReveal={canReveal} />
            </span>
          ),
        },
        { key: "qualification", label: labels.qualification },
        { key: "expDisplay", label: labels.experience, align: "right" },
        { key: "skillsDisplay", label: labels.skills },
        { key: "sourceDisplay", label: labels.source },
        { key: "stage", label: labels.stage, cellType: "status" },
        { key: "appliedDate", label: labels.applied },
      ]}
      rows={rows}
      rowLinkKey="href"
      rowLinkPrefix=""
      identifyingColumnKey="applicantName"
      sortable
      filterable
      filterKeys={["applicantName", "qualification", "skillsDisplay", "sourceDisplay", "stage"]}
      filterPlaceholder={labels.filterPlaceholder}
      emptyIcon="🧑‍💼"
      emptyTitle={labels.emptyTitle}
      emptyMessage={labels.emptyMessage}
      pageSize={20}
    />
  );
}
