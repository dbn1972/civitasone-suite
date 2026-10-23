import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { getInspectionById } from "../../_data/loaders";

export const dynamic = "force-dynamic";

function text(v: unknown): string {
  return typeof v === "string" && v.length > 0 ? v : "—"; // ux-001-ok: field formatter on an already-loaded record
}

/**
 * Read-only inspection detail. Target of the inspection-id link on the
 * inspections list (GAP-INSPECTION-INSPECTIONS-01). The backend authorises the
 * read (GET /v1/inspection/inspections/:id); a 404 is shown as not-found and
 * any other failure as a retryable load error, never as an empty record.
 */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { data: insp, source, status } = await getInspectionById(params.id);
  if (status === 404 || (source === "api" && !insp)) notFound();
  if (source === "error" || !insp) {
    return (
      <div className="wrap">
        <PageHeader title="Inspection" back="/inspection/inspections" />
        <RefreshErrorState error={toHumanError("load", { area: "inspection" })} backHref="/inspection/inspections" />
      </div>
    );
  }
  const when = (insp.scheduledDate ?? insp.createdAt) as string | null | undefined;
  const inspectors = Array.isArray(insp.assignedInspectors) ? (insp.assignedInspectors as unknown[]).map(String) : [];
  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/inspection" className="lnk">Inspection</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <Link href="/inspection/inspections" className="lnk">Inspections</Link>
        <span aria-hidden style={{ margin: "0 7px" }}>/</span>
        <span aria-current="page">{text(insp.id).slice(0, 8)}</span>
      </nav>
      <PageHeader title="Inspection" back="/inspection/inspections" />
      <Card>
        <dl className="kv">
          <dt>Inspection ID</dt>
          <dd>{text(insp.id)}</dd>
          <dt>Entity</dt>
          <dd>{text(insp.entityId)}</dd>
          <dt>Status</dt>
          <dd>{typeof insp.state === "string" ? <StatusPill status={insp.state} /> : "—"}</dd>
          <dt>Scheduled</dt>
          <dd>{when ? formatIndianDate(when) : "—"}</dd>
          <dt>Inspector(s)</dt>
          <dd>{inspectors.length > 0 ? inspectors.join(", ") : "—"}</dd>
        </dl>
      </Card>
    </div>
  );
}
