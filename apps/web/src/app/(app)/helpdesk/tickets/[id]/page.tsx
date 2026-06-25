import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, DataTable, EmptyState } from "../../../../_components/ds";
import { getHelpdeskTicketById } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { SlaBadge } from "../../SlaBadge";
import { TicketActions } from "./TicketActions";
import { TicketConversation } from "./TicketConversation";

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
  const { data: ticket, source } = await getHelpdeskTicketById(params.id);

  if (!ticket) {
    return (
      <>
        <PageHeader title="Ticket Detail" back="/helpdesk/tickets" backLabel="Tickets" />
        {source === "error" && <DataSourceBadge source={source} />}
        <EmptyState icon="🎫" title="Ticket not found" message="This ticket does not exist or has been removed." />
      </>
    );
  }

  const STAGES = ["open", "in_progress", "pending", "resolved", "closed"] as const;
  const currentIdx = STAGES.indexOf(ticket.status as typeof STAGES[number]);

  const commentRows: CommentRow[] = ticket.comments.map((c) => ({
    id: c.id,
    createdAt: formatIndianDate(c.createdAt),
    author: c.author,
    isInternal: c.isInternal,
    authorLabel: c.isInternal ? `${c.author} (internal)` : c.author,
    content: c.content,
  }));

  return (
    <>
      <PageHeader
        title={`Ticket ${ticket.ticketNo}`}
        subtitle="🎫 Tickets, SLAs, agents, queues and knowledge base."
        back="/helpdesk/tickets"
        backLabel="Tickets"
        actions={<TicketActions ticketId={ticket.id} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Ticket Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Subject</div><div className="v">{ticket.subject}</div></div>
              <div className="fld"><div className="l">Requester</div><div className="v">{ticket.requesterName}</div></div>
              <div className="fld"><div className="l">Priority</div><div className="v"><StatusPill status={ticket.priority} /></div></div>
              <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={ticket.status} label={ticket.status.replace(/_/g, " ")} /></div></div>
              <div className="fld"><div className="l">Channel</div><div className="v">{ticket.channel ?? "—"}</div></div>
              <div className="fld"><div className="l">SLA</div><div className="v"><SlaBadge status={ticket.slaStatus} /></div></div>
              <div className="fld"><div className="l">Agent</div><div className="v">{ticket.assignedTo ?? "Unassigned"}</div></div>
              <div className="fld"><div className="l">Created</div><div className="v">{formatIndianDate(ticket.createdAt)}</div></div>
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
              {ticket.requesterEmail && <div className="fld"><div className="l">Email</div><div className="v">{ticket.requesterEmail}</div></div>}
              <div className="fld"><div className="l">Agent</div><div className="v">{ticket.assignedTo ?? "Unassigned"}</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
