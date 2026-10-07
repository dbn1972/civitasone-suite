import { PageHeader, StatusPill, RefreshErrorState } from "../../../../_components/ds";
import { getInternalHelpdeskTicketById } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { SlaBadge } from "../../SlaBadge";
import { getSessionRoles, hasAnyRole, HELPDESK_ROLES } from "@/lib/auth/roleGuard";
import { InternalTicketActions } from "./InternalTicketActions";
import { helpdeskPriorityVariant } from "@/lib/helpdesk/priorityVariants";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: ticket, source, status } = await getInternalHelpdeskTicketById(params.id);

  // GAP-HELPDESK-INTERNAL-DETAIL-03: distinguish fetch failure from a real 404.
  if (!ticket) {
    if (source === "error" && status !== 404) {
      return (
        <>
          <PageHeader title="Internal Ticket" back="/helpdesk/internal" backLabel="Internal" />
          <RefreshErrorState error={toHumanError("load", { area: "internal ticket" })} backHref="/helpdesk/internal" />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Internal Ticket" back="/helpdesk/internal" backLabel="Internal" />
        <div className="card pad">
          <p style={{ color: "var(--mut)" }}>This internal ticket does not exist or has been removed.</p>
        </div>
      </>
    );
  }

  // GAP-HELPDESK-INTERNAL-DETAIL-05: show a real ticket number or a clean subtitle
  // instead of a truncated UUID
  const displayRef = ticket.ticketNo ?? `INT-${ticket.id.slice(0, 8).toUpperCase()}`;
  const subtitle = ticket.createdAt
    ? `${displayRef} · Raised ${formatIndianDate(ticket.createdAt)}`
    : displayRef;

  // GAP-HELPDESK-INTERNAL-DETAIL-02: mutation controls only for helpdesk roles
  const canAct = hasAnyRole(getSessionRoles(), HELPDESK_ROLES);

  return (
    <>
      <PageHeader
        title={ticket.subject}
        subtitle={subtitle}
        back="/helpdesk/internal"
        backLabel="Internal"
      />
      <div className="card">
        <div className="pad fields">
          <div className="fld"><div className="l">Priority</div><div className="v"><StatusPill status={ticket.priority.toLowerCase()} label={ticket.priority} variant={helpdeskPriorityVariant(ticket.priority)} /></div></div>
          <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={ticket.status.toLowerCase().replace(/ /g, "_")} label={ticket.status} /></div></div>
          <div className="fld"><div className="l">SLA</div><div className="v">{ticket.slaStatus ? <SlaBadge status={ticket.slaStatus} /> : "—"}</div></div>
          <div className="fld"><div className="l">Due</div><div className="v">{ticket.dueDate ? formatIndianDate(ticket.dueDate) : "—"}</div></div>
          <div className="fld"><div className="l">Assignee</div><div className="v">{ticket.assignee ?? "Unassigned"}</div></div>
          {ticket.requester ? (
            <div className="fld"><div className="l">Requester</div><div className="v">{ticket.requester}</div></div>
          ) : null}
        </div>
      </div>

      {/* GAP-HELPDESK-INTERNAL-DETAIL-01: render the description typed in the form */}
      {ticket.description ? (
        <div className="card pad" style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>
          <div className="card-h"><h3>Description</h3></div>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6 }}>{ticket.description}</p>
        </div>
      ) : null}

      {/* GAP-HELPDESK-INTERNAL-DETAIL-02: work the ticket (helpdesk roles only) */}
      {canAct ? <InternalTicketActions ticketId={ticket.id} currentStatus={ticket.status} /> : null}
    </>
  );
}
