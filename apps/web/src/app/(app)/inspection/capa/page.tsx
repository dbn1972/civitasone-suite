import Link from "next/link";
import { PageHeader, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { getInspectionCapas, CapaListItemSchema, type CapaListItem } from "../_data/loaders";
import { CapaRowAction } from "./CapaActions";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, todayIST } from "@/lib/formatters";

export const dynamic = "force-dynamic";

function shortId(id: unknown): string {
  const s = String(id ?? "");
  return s ? `${s.slice(0, 8)}…` : "—";
}

/** GAP-INSPECTION-CAPA-05: a CAPA is overdue when its due date is in the past
 * and it is not already a terminal state. The service also has its own
 * `overdue` status; either signal flags the row. */
function isOverdue(row: CapaListItem): boolean {
  if (row.status === "overdue") return true;
  if (!row.dueDate) return false;
  const done = row.status === "completed" || row.status === "verified";
  return !done && row.dueDate < todayIST();
}

export default async function Page() {
  const result = await getInspectionCapas();
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-INSPECTION-CAPA-05: parse to typed rows and sort by due date ascending
  // so overdue / soonest-due rows lead; undated rows sort last.
  const rows: CapaListItem[] = errored
    ? []
    : result.data
        .map((raw) => CapaListItemSchema.parse(raw))
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return 0;
        });

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">CAPA</span>
      </nav>
      <PageHeader title="CAPA" back="/inspection" />
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "CAPA records" })} backHref="/inspection" />
      ) : rows.length === 0 ? (
        <EmptyState icon="📭" title="No records" message="No corrective actions yet. They appear here once a finding raises one." />
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Status</th>
                <th scope="col">Summary</th>
                <th scope="col">Owner</th>
                <th scope="col">Due</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overdue = isOverdue(row);
                return (
                  <tr key={row.id}>
                    <td>{shortId(row.id)}</td>
                    <td>{row.status ? <StatusPill status={overdue ? "overdue" : row.status} /> : "—"}</td>
                    {/* corrective_actions.description is a mandatory, non-null column
                        (capa/schema.ts) — the one field that describes the CAPA. */}
                    <td>{row.description ?? "—"}</td>
                    <td>{shortId(row.ownerId)}</td>
                    <td style={overdue ? { color: "var(--bad)" } : undefined}>{formatIndianDate(row.dueDate)}</td>
                    <td>
                      <CapaRowAction id={row.id} status={String(row.status ?? "")} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
