import Link from "next/link";
import { PageHeader, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getInspectionCapas } from "../_data/loaders";
import { CapaRowAction } from "./CapaActions";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInspectionCapas();
  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">CAPA</span>
      </nav>
      <PageHeader title="CAPA" back="/inspection" />
      {source === "error" && <DataSourceBadge source={source} />}
      {data.length === 0 ? (
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
                  <td>{String(row.title ?? row.name ?? row.findingCode ?? row.entityId ?? "—")}</td>
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
