"use client";

import Link from "next/link";
import { DataTable } from "../../../_components/ds";
import { LocationRowActions } from "./LocationRowActions";

/**
 * W1 SF-08: the locations register as a CLIENT component. The page is a Server
 * Component and cannot pass `render:` functions across the RSC boundary (the
 * GAP-HR-EXPENSES-01 crash class), so the page now passes plain data (rows,
 * pre-translated labels, a permission flag) and the column renderers live here.
 */
export type Location = {
  id: string;
  name: string;
  type: string;
  addressLine?: string;
  city?: string;
  state?: string;
  district?: string;
  postalCode?: string;
  lgdCode?: string;
  parentId?: string;
  status?: string;
} & Record<string, unknown>;

// Kept local so this fix stays inside this page's own files -- see GAP-HR-LOCATIONS-05.
const LOCATION_TYPE_LABELS: Record<string, string> = {
  state: "State",
  district: "District",
  block: "Block",
  ward: "Ward",
  office: "Office",
  facility: "Facility",
  branch: "Branch",
};

/** MapPin icon as inline SVG (lucide-react compatible). */
function MapPin({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, verticalAlign: "middle" }}
    >
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export type LocationsTableLabels = Record<"colCity" | "colDistrict" | "colLgdCode" | "colName" | "colPostalCode" | "colState" | "colStatus" | "colType" | "filterPlaceholder" | "noMatchMessage" | "noMatchTitle", string>;

export function LocationsTable({ locations, labels, canManage }: { locations: Location[]; labels: LocationsTableLabels; canManage: boolean }) {
  return (
    <DataTable<Location>
      columns={[
        {
          key: "name",
          label: labels.colName,
          render: (row) => (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <MapPin size={13} color="var(--primary,#2563eb)" />
              {/* GAP-HR-LOCATIONS-03: name opens the per-location page (employees assigned here). */}
              <Link href={`/hr/locations/${row.id}`} style={{ fontWeight: 500 }}>{row.name}</Link>
            </span>
          ),
        },
        {
          // GAP-HR-LOCATIONS-05: this column used to have no `render`,
          // so DataTable printed the raw lowercase enum value (e.g.
          // "facility") instead of a human label. (The stat-tile part
          // of this item's original claim -- tile counts not summing
          // to total, and an un-honest "Block" label -- was checked
          // against current source and found already correct: the
          // label already reads "Block / Other" and blockCount is
          // defined as everything-not-state-or-district, so the three
          // tiles already sum to the total by construction. Only this
          // column render was actually missing.)
          key: "type",
          label: labels.colType,
          render: (row) => <span>{LOCATION_TYPE_LABELS[row.type] ?? row.type}</span>,
        },
        {
          key: "state",
          label: labels.colState,
          render: (row) => (
            <span>
              {row.state ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: "var(--infobg, #eff6ff)",
                    color: "var(--info, #1d4ed8)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {String(row.state)}
                </span>
              ) : "—"}
            </span>
          ),
        },
        {
          key: "district",
          label: labels.colDistrict,
          render: (row) => (
            <span>
              {row.district ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: "var(--goodbg, #f0fdf4)",
                    color: "var(--good, #15803d)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {String(row.district)}
                </span>
              ) : "—"}
            </span>
          ),
        },
        { key: "city",       label: labels.colCity },
        { key: "postalCode", label: labels.colPostalCode },
        {
          // GAP-HR-LOCATIONS-01 fix step 3: lgdCode was collected on
          // create but never shown anywhere.
          key: "lgdCode",
          label: labels.colLgdCode,
          render: (row) => <span>{row.lgdCode || "—"}</span>,
        },
        {
          // GAP-HR-LOCATIONS-02 fix step 3: show archived rows (via a
          // status column) rather than the read-only register having
          // no status/lifecycle visibility at all. Sortable/filterable
          // text lets a viewer type "archived" to isolate them, since
          // this page doesn't yet have a dedicated status filter
          // control.
          key: "status",
          label: labels.colStatus,
          render: (row) => {
            const archived = row.status === "archived";
            return (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 10,
                  background: archived ? "var(--bg, #f1f5f9)" : "var(--goodbg, #f0fdf4)",
                  color: archived ? "var(--slate, #64748b)" : "var(--good, #15803d)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {archived ? "Archived" : "Active"}
              </span>
            );
          },
        },
        ...(canManage
          ? [
              {
                key: "actions",
                label: "",
                render: (row: Location) => <LocationRowActions id={row.id} name={row.name} archived={row.status === "archived"} />,
              },
            ]
          : []),
      ]}
      rows={locations}
      sortable
      filterable
      filterPlaceholder={labels.filterPlaceholder}
      emptyIcon="📍"
      emptyTitle={labels.noMatchTitle}
      emptyMessage={labels.noMatchMessage}
    />
  );
}
