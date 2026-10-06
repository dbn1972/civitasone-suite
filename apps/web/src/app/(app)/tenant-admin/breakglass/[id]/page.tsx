import { notFound } from "next/navigation";
import { PageHeader, Card, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { getBreakglassEvent } from "@/app/_data/loaders";
import { formatIndianDateTime, formatDuration } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { Breadcrumb } from "../../Breadcrumb";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
      <dt style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 500 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>{value}</dd>
    </div>
  );
}

export default async function BreakglassDetailPage({ params }: { params: { id: string } }) {
  const result = await getBreakglassEvent(params.id);

  // GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-02: a real 404 is a not-found page, not
  // a generic error; any other failure shows an honest refresh-error state
  // (never a fabricated record — DETAIL-01/04).
  if (result.status === 404) {
    notFound();
  }
  if (result.source === "error" || result.data === null) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Break-Glass", href: "/tenant-admin/breakglass" }, { label: `Event ${params.id}` }]} />
        <PageHeader back="/tenant-admin/breakglass" title="Break-Glass Event Detail" />
        <Card title="Event Information" padding>
          <RefreshErrorState error={toHumanError("load", { area: "break-glass event" })} backHref="/tenant-admin/breakglass" />
        </Card>
      </div>
    );
  }

  const event = result.data;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Break-Glass", href: "/tenant-admin/breakglass" }, { label: `Event ${params.id}` }]} />
      <PageHeader
        back="/tenant-admin/breakglass"
        title="Break-Glass Event Detail"
        subtitle={`Emergency access event initiated by ${event.actor}`}
        actions={<StatusPill status={event.status} />}
      />

      <div className="grid g-2" style={{ marginTop: 18 }}>
        <Card title="Event Information" padding>
          <dl style={{ margin: 0 }}>
            <Field label="Initiated By" value={event.actor} />
            {event.actorEmail && <Field label="Email" value={event.actorEmail} />}
            <Field label="Status" value={<StatusPill status={event.status} />} />
            <Field label="Started" value={formatIndianDateTime(event.startedAt)} />
            <Field label="Ended" value={event.endedAt ? formatIndianDateTime(event.endedAt) : "—"} />
            <Field label="Duration" value={formatDuration(event.startedAt, event.endedAt)} />
            {event.closedBy && <Field label="Closed By" value={event.closedBy} />}
            {event.closeReason && <Field label="Close Reason" value={event.closeReason} />}
          </dl>
        </Card>
        <Card title="Reason" padding>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{event.reason}</p>
        </Card>
      </div>

      {/* DETAIL-03: render resource identifiers as labels only; never invent
          them. Only shown when the API actually supplies them. */}
      {event.resourcesAccessed && event.resourcesAccessed.length > 0 && (
        <Card title="Resources Accessed" padding>
          <ul aria-label="Resources accessed during break-glass" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {event.resourcesAccessed.map((resource, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
                <span aria-hidden="true">🔓</span>
                <span className="mono" style={{ fontSize: 13 }}>{resource}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {event.approvalChain && event.approvalChain.length > 0 && (
        <Card title="Approval Chain" padding>
          <ol aria-label="Approval chain" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {event.approvalChain.map((step, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--primary-l, #eff6ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{step.name} <span style={{ fontWeight: 400, color: "var(--ink2)" }}>({step.role})</span></p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>
                    {step.timestamp ? formatIndianDateTime(step.timestamp) : "—"}
                  </p>
                </div>
                {/* DETAIL-05: let StatusPill map the decision (acknowledged /
                    initiated now have explicit tones) instead of guessing. */}
                <StatusPill status={step.decision} />
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
