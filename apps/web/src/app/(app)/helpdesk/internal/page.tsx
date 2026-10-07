import Link from "next/link";
import { PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getInternalHelpdeskTickets } from "../../../_data/loaders";
import { getSessionRoles, hasAnyRole, HELPDESK_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { InternalTicketsTable } from "./InternalTicketsTable";

export default async function Page() {
  const { data: tickets, source } = await getInternalHelpdeskTickets();
  const errored = source === "error";

  // GAP-HELPDESK-INTERNAL-03: only show "+ New Ticket" to helpdesk roles
  const sessionRoles = getSessionRoles();
  const canCreate = hasAnyRole(sessionRoles, HELPDESK_ROLES);

  const open = errored ? 0 : tickets.filter((t) => t.status === "Open" || t.status === "In Progress").length;
  const resolved = errored ? 0 : tickets.filter((t) => t.status === "Resolved" || t.status === "Closed").length;
  const critical = errored ? 0 : tickets.filter((t) => t.priority === "Critical").length;

  return (
    <>
      <PageHeader
        title="Internal Helpdesk"
        // GAP-HELPDESK-INTERNAL-05: removed service name leak from subtitle
        subtitle="Staff operations queue."
        back="/helpdesk"
        actions={
          canCreate ? (
            <Link href="/helpdesk/internal/new" className="btn primary">+ New Ticket</Link>
          ) : undefined
        }
      />
      {/* GAP-HELPDESK-INTERNAL-01: on error, show an error state, not silent zeros */}
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "internal tickets" })} backHref="/helpdesk" />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="🎫" label="Total Tickets" value={tickets.length.toLocaleString("en-IN")} />
            <StatCard icon="🔵" label="Open" value={open.toLocaleString("en-IN")} />
            <StatCard icon="✅" label="Resolved" value={resolved.toLocaleString("en-IN")} />
            <StatCard icon="🔴" label="Critical" value={critical.toLocaleString("en-IN")} />
          </StatGrid>
          <InternalTicketsTable tickets={tickets} />
        </>
      )}
    </>
  );
}
