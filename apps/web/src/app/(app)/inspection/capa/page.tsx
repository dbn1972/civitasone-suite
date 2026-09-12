import Link from "next/link";
import { PageHeader, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getInspectionCapas } from "../_data/loaders";
import { CapaRowAction } from "./CapaActions";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getInspectionCapas();
  const { data } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">CAPA</span>
      </nav>
      <PageHeader title="CAPA" back="/inspection" />
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "CAPA records" })} backHref="/inspection" />
      ) : data.length === 0 ? (
        <EmptyState icon="📭" title="No records" message="No CAPA records returned from the API." />
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
                  <td>{String(row.status ?? "—")}</td>
                  {/* corrective_actions.description is a mandatory, non-null column
                      (capa/schema.ts) — it's the one field that actually describes
                      what the CAPA is about. title/name/findingCode don't exist on
                      this row shape, so without `description` first every CAPA's
                      Summary cell rendered "—" unconditionally. */}
                  <td>{String(row.description ?? row.title ?? row.name ?? row.findingCode ?? row.entityId ?? "—")}</td>
                  <td>
                    <CapaRowAction id={String(row.id)} status={String(row.status ?? "")} />
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
