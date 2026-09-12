import Link from "next/link";
import { PageHeader, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getInspectionAssignments } from "../_data/loaders";
import { AssignmentActions } from "./AssignmentActions";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getInspectionAssignments();
  const { data } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">Assignments</span>
      </nav>
      <PageHeader title="Assignments" back="/inspection" />
      <AssignmentActions />
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "assignments" })} backHref="/inspection" />
      ) : data.length === 0 ? (
        <EmptyState icon="📭" title="No records" message="No assignments returned from the API." />
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Status</th>
                <th scope="col">Summary</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={String(row.id)}>
                  <td>{String(row.id).slice(0, 8)}…</td>
                  <td>{String(row.status ?? "—")}</td>
                  <td>{String(row.title ?? row.name ?? row.findingCode ?? row.entityId ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
