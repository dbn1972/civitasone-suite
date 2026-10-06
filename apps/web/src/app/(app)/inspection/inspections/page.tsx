import Link from "next/link";
import { z } from "zod";
import { PageHeader, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { getInspectionsPage, INSPECTIONS_PAGE_SIZE } from "../_data/loaders";
import { InspectionRowAction } from "./InspectionActions";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";

export const dynamic = "force-dynamic";

/**
 * GAP-INSPECTION-INSPECTIONS-03: parse each row with a schema that REQUIRES the
 * real status column `state` (execution.inspections.state is NOT NULL — see
 * schema.ts), so a backend rename that dropped it fails loudly (-> error state)
 * instead of silently rendering "—" for every row. `state` being required is
 * safe precisely because the column is non-null; the other human fields stay
 * optional/passthrough so a not-yet-rolled-out column keeps the list readable.
 */
const InspectionRowSchema = z
  .object({
    id: z.string(),
    state: z.string(),
    entityId: z.string().optional(),
    scheduledDate: z.string().nullish(),
    createdAt: z.string().optional(),
  })
  .passthrough();
type InspectionRow = z.infer<typeof InspectionRowSchema>;

function shortId(id: unknown): string {
  const s = String(id ?? "");
  return s ? `${s.slice(0, 8)}…` : "—";
}

export default async function Page({
  searchParams,
}: {
  searchParams?: { page?: string };
}) {
  // GAP-INSPECTION-INSPECTIONS-05: request one server-side page at a time
  // (page/pageSize forwarded to the list endpoint) instead of fetching a
  // capped 50 rows with no way to see the rest. A bad ?page value falls back
  // to page 1.
  const pageParam = Number(searchParams?.page ?? "1");
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;

  const result = await getInspectionsPage(page);
  const resource = toResourceState(result);

  // GAP-INSPECTION-INSPECTIONS-03: a schema mismatch is treated as an error,
  // not an empty/garbled table.
  const parsed = z.array(InspectionRowSchema).safeParse(result.data.rows);
  const errored = resource.status === "error" || !parsed.success;
  const rows: InspectionRow[] = parsed.success ? parsed.data : [];

  const total = result.data.total;
  const hasPrev = page > 1;
  // Prefer the server's reported total; otherwise infer "there may be more"
  // from a full page of rows.
  const hasNext =
    total !== null ? page * INSPECTIONS_PAGE_SIZE < total : rows.length === INSPECTIONS_PAGE_SIZE;

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">Inspections</span>
      </nav>
      <PageHeader title="Inspections" back="/inspection" />
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "inspections" })} backHref="/inspection" />
      ) : rows.length === 0 ? (
        // GAP-INSPECTION-INSPECTIONS-06: friendly, honest empty copy + a CTA to
        // where inspections originate, instead of "No inspections returned from
        // the API."
        <EmptyState
          icon="📭"
          title="No inspections yet"
          message="Inspections appear here once an assignment is scheduled."
          action={<Link href="/inspection/assignments" className="btn ghost">Go to assignments</Link>}
        />
      ) : (
        <>
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Inspection</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Scheduled</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{shortId(row.id)}</td>
                    <td>{shortId(row.entityId)}</td>
                    <td>{formatIndianDate(row.scheduledDate ?? row.createdAt)}</td>
                    <td><StatusPill status={row.state} /></td>
                    <td>
                      <InspectionRowAction id={row.id} status={row.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* GAP-INSPECTION-INSPECTIONS-05: prev/next pager over server-side
              pages. Rendered as plain links so it works without client JS. */}
          {(hasPrev || hasNext) && (
            <nav aria-label="Pagination" style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              {hasPrev ? (
                <Link href={`/inspection/inspections?page=${page - 1}`} className="btn ghost" rel="prev">
                  Previous
                </Link>
              ) : (
                <span className="btn ghost" aria-disabled="true" style={{ opacity: 0.5, pointerEvents: "none" }}>
                  Previous
                </span>
              )}
              <span style={{ fontSize: 13 }} aria-current="page">
                Page {page}
                {total !== null ? ` of ${Math.max(1, Math.ceil(total / INSPECTIONS_PAGE_SIZE))}` : ""}
              </span>
              {hasNext ? (
                <Link href={`/inspection/inspections?page=${page + 1}`} className="btn ghost" rel="next">
                  Next
                </Link>
              ) : (
                <span className="btn ghost" aria-disabled="true" style={{ opacity: 0.5, pointerEvents: "none" }}>
                  Next
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
