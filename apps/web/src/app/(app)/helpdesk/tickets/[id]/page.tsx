import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, EmptyState, RefreshErrorState, Masked } from "../../../../_components/ds";
import { getHelpdeskTicketById } from "../../../../_data/loaders";
import { formatIndianDateTime } from "@/lib/formatters";
import { humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { SlaBadge } from "../../SlaBadge";
import { TicketActions } from "./TicketActions";
import { TicketConversation } from "./TicketConversation";
import { helpdeskPriorityVariant } from "@/lib/helpdesk/priorityVariants";

type CommentRow = {
  id: string;
  createdAt: string;
  author: string;
  isInternal: boolean;
  content: string;
  // DataTable requires Record<string, unknown>
  authorLabel: string;
};

export default async function Page({ params }: { params: { id: string } }) {
  const { data: ticket, source, status } = await getHelpdeskTicketById(params.id);

  // GAP-HELPDESK-TICKETS-DETAIL-02: a failed fetch must not read as "ticket
  // deleted". Only a genuine 404 (or a valid empty response) shows the
  // "not found" empty state; any other error (5xx, 401, network) shows a
  // retry error state, matching sibling pages (helpdesk/page.tsx etc.).
  if (source === "error" && status !== 404) {
    return (
      <>
        <PageHeader title="Ticket Detail" back="/helpdesk/tickets" backLabel="Tickets" />
        <RefreshErrorState error={toHumanError("load", { area: "ticket" })} backHref="/helpdesk/tickets" />
      </>
    );
  }

  if (!ticket) {
    return (
      <>
        <PageHeader title="Ticket Detail" back="/helpdesk/tickets" backLabel="Tickets" />
        <EmptyState icon="🎫" title="Ticket not found" message="This ticket does not exist or has been removed." />
      </>
    );
  }

  const STAGES = ["open", "in_progress", "pending", "resolved", "closed"] as const;
  const currentIdx = STAGES.indexOf(ticket.status as typeof STAGES[number]);

  const commentRows: CommentRow[] = ticket.comments.map((c) => ({
    id: c.id,
    createdAt: formatIndianDateTime(c.createdAt),
    author: c.author,
    isInternal: c.isInternal,
    authorLabel: c.isInternal ? `${c.author} (internal)` : c.author,
    content: c.content,
  }));

  // GAP-HELPDESK-TICKETS-DETAIL-04: only staff with helpdesk/citizen roles may
  // see mutation buttons. A non-agent viewer (citizen, public) sees no actions.
  const HELPDESK_STAFF_ROLES = [
    "helpdesk_user", "helpdesk_agent", "helpdesk_admin",
    "citizen_officer", "citizen_admin", "super_admin",
  ];
  const sessionRoles = getSessionRoles();
  const canAct = hasAnyRole(sessionRoles, HELPDESK_STAFF_ROLES);

  return (
    <>
      <PageHeader
        title={`Ticket ${ticket.ticketNo}`}
        subtitle={`Opened ${formatIndianDateTime(ticket.createdAt)} via ${humanizeStatus(ticket.channel ?? "web")}`}
        back="/helpdesk/tickets"
        backLabel="Tickets"
        actions={<TicketActions ticketId={ticket.id} status={ticket.status} canAct={canAct} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Ticket Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Subject</div><div className="v">{ticket.subject}</div></div>
              <div className="fld"><div className="l">Requester</div><div className="v">{ticket.requesterName}</div></div>
              <div className="fld"><div className="l">Priority</div><div className="v"><StatusPill status={ticket.priority} variant={helpdeskPriorityVariant(ticket.priority)} /></div></div>
              <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={ticket.status} label={ticket.status.replace(/_/g, " ")} /></div></div>
              <div className="fld"><div className="l">Channel</div><div className="v">{ticket.channel ? humanizeStatus(ticket.channel) : "—"}</div></div>
              <div className="fld"><div className="l">SLA</div><div className="v"><SlaBadge status={ticket.slaStatus} /></div></div>
              <div className="fld"><div className="l">Agent</div><div className="v">{ticket.assignedTo ?? "Unassigned"}</div></div>
              <div className="fld"><div className="l">Created</div><div className="v">{formatIndianDateTime(ticket.createdAt)}</div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <h3>Conversation</h3>
            </div>
            <TicketConversation comments={commentRows} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Workflow</h3></div>
            <div className="pad">
              <ul className="tl">
                {STAGES.map((stage, i) => (
                  <li key={stage} className={i < currentIdx ? "done" : i === currentIdx ? "cur" : "todo"}>
                    <div className="t">{stage.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Parties</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Requester</div><div className="v">{ticket.requesterName}</div></div>
              {ticket.requesterEmail && <div className="fld"><div className="l">Email</div><div className="v"><Masked value={ticket.requesterEmail} kind="email" ariaLabel="Citizen email (masked)" /></div></div>}
              <div className="fld"><div className="l">Agent</div><div className="v">{ticket.assignedTo ?? "Unassigned"}</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
