"use client";

/**
 * Client wrapper around the shared DataTable so the actions column
 * (IdCardActions, onClick handlers) and the "Vendor/Project"/"Last verified"
 * columns can use a `render` cell — DataTable's own doc comment is explicit
 * that `render` "cannot be passed from Server Components" (functions can't
 * cross the RSC boundary; see GAP-HR-EXPENSES-01 / PR #1647 for the crash
 * this caused elsewhere). page.tsx (a Server Component) does the data
 * fetching/role-gating and hands this component plain, already-shaped rows.
 */
import { DataTable } from "@/app/_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { IdCardActions } from "./IdCardActions";

export type IdCardRow = {
  id: string;
  card_number: string;
  holder_name: string;
  designation: string;
  department: string;
  card_type: string;
  vendor_name: string | null;
  project_name: string | null;
  valid_until: string;
  last_verified_at: string | null;
  verification_count: number;
  status: string;
} & Record<string, unknown>;

export function IdCardsTable({ rows }: { rows: IdCardRow[] }) {
  const columns: {
    key: keyof IdCardRow & string;
    label: string;
    cellType?: "status" | "date";
    sortable?: boolean;
    render?: (row: IdCardRow) => React.ReactNode;
  }[] = [
    { key: "card_number", label: "Card #" },
    { key: "holder_name", label: "Holder" },
    { key: "designation", label: "Designation" },
    { key: "department", label: "Department" },
    // GAP-HR-ID-CARDS-04: card_type was printed as the raw enum
    // ("vendor_staff") -- humanizeStatus gives the same Title Case treatment
    // every other un-labeled status/enum column in this app already uses
    // (lib/formatters.ts), rather than a bespoke per-value label map.
    { key: "card_type", label: "Type", render: (row) => humanizeStatus(row.card_type) },
    // GAP-HR-ID-CARDS-04: vendor_name/project_name were fetched by the
    // backend and even present on the Row type, but never rendered anywhere.
    {
      key: "vendor_name",
      label: "Vendor / Project",
      render: (row) => row.vendor_name ?? row.project_name ?? "—",
    },
    { key: "valid_until", label: "Valid Until", cellType: "date" },
    {
      key: "last_verified_at",
      label: "Last Verified",
      render: (row) => (row.last_verified_at ? formatIndianDate(row.last_verified_at) : "—"),
    },
    { key: "verification_count", label: "Verifications" },
    // GAP-HR-ID-CARDS-03: prints the server-derived effective status
    // (page.tsx/routes.ts now agree — see their own comments) rather than
    // the raw DB column, so a lapsed card reads "Expired", not "Active".
    { key: "status", label: "Status", cellType: "status" },
    {
      key: "id",
      label: "Actions",
      sortable: false,
      render: (row) => <IdCardActions id={row.id} holderName={row.holder_name} status={row.status} />,
    },
  ];

  return (
    // GAP-HR-ID-CARDS-05: search/status now reach the WHOLE tenant register
    // via page.tsx's own server-side form (search/status query params, same
    // pattern as GAP-HR-DIRECTORY-03) -- no second, client-only `filterable`
    // box here, which would only ever re-narrow this one already-filtered
    // page and could look like it "missed" a match that's actually just on
    // another page.
    <DataTable<IdCardRow>
      columns={columns}
      rows={rows}
      sortable
      pageSize={20}
      emptyIcon="🆔"
      emptyTitle="No ID cards issued"
      emptyMessage="ID cards for employees and vendor staff appear here once issued by HR administration."
    />
  );
}
