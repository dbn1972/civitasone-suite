import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, EmptyState } from "../../../../_components/ds";
import { fetchJson } from "../../../../_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { SlaBadge } from "../../SlaBadge";

type InternalTicket = {
  id: string;
  subject: string;
  priority: string;
  status: string;
  dueDate?: string;
  slaStatus?: string;
  assignee?: string;
};

export default async function Page({ params }: { params: { id: string } }) {
  const { data: ticket, source } = await fetchJson<unknown, InternalTicket | null>(
    `/api/v1/helpdesk/tickets/${params.id}`,
    null,
    {
      revalidateSeconds: 30,
      telemetryKey: "helpdesk.internal.detail",
      mapResponse: (payload) => {
        const raw =
          payload && typeof payload === "object" && "data" in payload
            ? (payload as { data: unknown }).data
            : payload;
        if (!raw || typeof raw !== "object") return null;
        const t = raw as Record<string, unknown>;
        if (typeof t.id !== "string") return null;
        return {
          id: t.id,
          subject: typeof t.subject === "string" ? t.subject : "",
          priority: typeof t.priority === "string" ? t.priority : "normal",
          status: typeof t.status === "string" ? t.status : "open",
          dueDate: typeof t.dueDate === "string" ? t.dueDate : undefined,
          slaStatus: typeof t.slaStatus === "string" ? t.slaStatus : undefined,
          assignee: typeof t.assignee === "string" ? t.assignee : undefined,
        } satisfies InternalTicket;
      },
    },
  );

  if (!ticket) {
    return (
      <>
        <PageHeader title="Internal Ticket" back="/helpdesk/internal" backLabel="Internal" />
        {source === "error" && <DataSourceBadge source={source} />}
        <EmptyState icon="🎫" title="Ticket not found" message="This internal ticket does not exist." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={ticket.subject}
        subtitle={`Internal ticket ${ticket.id.slice(0, 8).toUpperCase()}`}
        back="/helpdesk/internal"
        backLabel="Internal"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="pad fields">
          <div className="fld"><div className="l">Priority</div><div className="v"><StatusPill status={ticket.priority.toLowerCase()} label={ticket.priority} /></div></div>
          <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={ticket.status.toLowerCase().replace(/ /g, "_")} label={ticket.status} /></div></div>
          <div className="fld"><div className="l">SLA</div><div className="v">{ticket.slaStatus ? <SlaBadge status={ticket.slaStatus} /> : "—"}</div></div>
          <div className="fld"><div className="l">Due</div><div className="v">{ticket.dueDate ? formatIndianDate(ticket.dueDate) : "—"}</div></div>
          <div className="fld"><div className="l">Assignee</div><div className="v">{ticket.assignee ?? "Unassigned"}</div></div>
        </div>
      </div>
    </>
  );
}
