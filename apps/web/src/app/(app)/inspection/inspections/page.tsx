import Link from "next/link";
import { PageHeader, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getInspections } from "../_data/loaders";
import { InspectionRowAction } from "./InspectionActions";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getInspections();
  const { data } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">Inspections</span>
      </nav>
      <PageHeader title="Inspections" back="/inspection" />
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "inspections" })} backHref="/inspection" />
      ) : data.length === 0 ? (
        <EmptyState icon="📭" title="No records" message="No inspections returned from the API." />
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Status</th>
                <th scope="col">Summary</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={String(row.id)}>
                  <td>{String(row.id).slice(0, 8)}…</td>
                  {/* execution.inspections' status column is named `state`, not `status`
                      (see services/inspection-service/src/modules/execution/schema.ts) —
                      the API returns the row verbatim, so `row.status` is always undefined
                      here. Reading `row.state` is what actually renders the real status and
                      is what makes InspectionRowAction's action-per-status switch reachable. */}
                  <td>{String(row.state ?? "—")}</td>
                  <td>{String(row.title ?? row.name ?? row.findingCode ?? row.entityId ?? "—")}</td>
                  <td>
                    <InspectionRowAction
                      id={String(row.id)}
                      status={String(row.state ?? "")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
