import Link from "next/link";
import { PageHeader, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { getInspectionAssignments } from "../_data/loaders";
import { AssignmentListItemSchema } from "../_data/loaders";
import { AssignmentActions } from "./AssignmentActions";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

/**
 * GAP-INSPECTION-ASSIGNMENTS-06: roles that may create an assignment. Must
 * match SUPERVISING_ROLES in services/inspection-service/src/modules/
 * assignment/routes.ts — the server is the authority; this is a client-side
 * courtesy gate only (to avoid showing a form that will be rejected).
 */
const ASSIGNMENT_CREATE_ROLES = [
  "supervising_officer",
  "inspection_admin",
  "tenant_admin",
  "super_admin",
] as const;

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
  // GAP-INSPECTION-ASSIGNMENTS-06: hide the create form for roles that cannot
  // create assignments (read-only viewers, inspectors, etc.). The server
  // enforces RBAC; this is a UI-side courtesy gate.
  const canCreate = hasAnyRole(getSessionRoles(), [...ASSIGNMENT_CREATE_ROLES]);
  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">Assignments</span>
      </nav>
      <PageHeader title="Assignments" back="/inspection" />
      {/* GAP-INSPECTION-ASSIGNMENTS-06: do not show the create form when the
          list failed to load (a failed page is not a safe place to accept a
          new assignment), and hide it for roles that cannot create assignments
          (server RBAC is authoritative; this is a courtesy gate only). */}
      {!errored && canCreate && <AssignmentActions />}
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
