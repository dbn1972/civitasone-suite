import Link from "next/link";
import { PageHeader, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { getInspectionAssignments } from "../_data/loaders";
import { AssignmentListItemSchema } from "../_data/loaders";
import { AssignmentActions } from "./AssignmentActions";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";

export const dynamic = "force-dynamic";

/** Short id for display when no human reference exists. */
function shortId(id: unknown): string {
  const s = String(id ?? "");
  return s ? `${s.slice(0, 8)}…` : "—";
}

export default async function Page() {
  const result = await getInspectionAssignments();
  const { data } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">Assignments</span>
      </nav>
      <PageHeader title="Assignments" back="/inspection" />
      {/* GAP-INSPECTION-ASSIGNMENTS-06: do not show the create form when the
          list failed to load — a failed page is not a safe place to accept a
          new assignment. The route itself remains the authoritative RBAC gate
          (assignment/routes.ts SUPERVISING_ROLES). */}
      {!errored && <AssignmentActions />}
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "assignments" })} backHref="/inspection" />
      ) : data.length === 0 ? (
        <EmptyState icon="📭" title="No assignments yet" message="Assignments appear here once an inspector is assigned to an inspection." />
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Assignment</th>
                <th scope="col">Inspection</th>
                <th scope="col">Inspector</th>
                <th scope="col">Entity</th>
                <th scope="col">Scheduled</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {/* GAP-INSPECTION-ASSIGNMENTS-04: render the real assignment
                  fields (assignment/schema.ts: inspectorId, scheduledDate,
                  entityId, status), not a title/name/findingCode guess that
                  rendered "—" for every row. */}
              {data.map((raw) => {
                const row = AssignmentListItemSchema.parse(raw);
                return (
                  <tr key={row.id}>
                    <td>{shortId(row.id)}</td>
                    <td>{shortId(row.inspectionId)}</td>
                    <td>{shortId(row.inspectorId)}</td>
                    <td>{shortId(row.entityId)}</td>
                    <td>{formatIndianDate(row.scheduledDate)}</td>
                    <td>{row.status ? <StatusPill status={row.status} /> : "—"}</td>
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
