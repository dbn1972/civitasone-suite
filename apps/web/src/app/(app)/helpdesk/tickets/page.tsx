import Link from "next/link";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getHelpdeskTicketList } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { TicketsTable } from "./TicketsTable";

export default async function Page() {
  const { data: tickets, source } = await getHelpdeskTicketList();
  const errored = source === "error";

  return (
    <>
      <PageHeader
        title="Citizen Tickets"
        subtitle="Citizen support tickets with SLA status and breach risk."
        back="/helpdesk"
        backLabel="Helpdesk"
        actions={
          <>
            <PrintExportButton label="Export" documentTitle="Helpdesk Tickets" />
            <Link href="/helpdesk/tickets/new" className="btn primary">+ New Ticket</Link>
          </>
        }
      />
      {errored && <RefreshErrorState error={toHumanError("load", { area: "tickets" })} backHref="/helpdesk" />}
      {/* GAP-HELPDESK-TICKETS-02: stat cards now live inside TicketsTable, computed
          from the same useSeededResource rows as the table — so cards and table
          can never disagree (offline/cached shows cached-derived counts). */}
      <TicketsTable tickets={tickets} source={source} />
    </>
  );
}
