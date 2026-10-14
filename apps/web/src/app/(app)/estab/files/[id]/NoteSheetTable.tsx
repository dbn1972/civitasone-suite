"use client";

import { DataTable } from "../../../../_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import { ResolvedOfficerName } from "./OfficerName";

export type NoteRow = {
  idx: number;
  content: string;
  author: string;
  when: string;
  type: string;
  status: string;
  signedAt?: string | null;
};

/**
 * Client wrapper: the Officer / Type columns use `render` functions, which
 * cannot cross the Server -> Client boundary from the page.
 */
export function NoteSheetTable({ rows }: { rows: NoteRow[] }) {
  return (
    <DataTable<NoteRow>
      columns={[
        { key: "idx", label: "#", align: "right" },
        { key: "content", label: "Note" },
        { key: "when", label: "When" },
        { key: "author", label: "Officer", render: (r) => <ResolvedOfficerName name={r.author} /> },
        {
          key: "type",
          label: "Type",
          render: (r) => (
            <>
              {r.type}
              {r.signedAt ? (
                <span style={{ color: "var(--mut)", marginInlineStart: 6, fontSize: 12 }}>
                  (signed {formatIndianDateTime(r.signedAt)})
                </span>
              ) : null}
            </>
          ),
        },
        { key: "status", label: "Status", cellType: "status" },
      ]}
      rows={rows}
    />
  );
}
