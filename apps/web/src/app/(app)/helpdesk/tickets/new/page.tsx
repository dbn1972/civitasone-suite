import { PageHeader } from "../../../../_components/ds";
import { NewTicketForm } from "./NewTicketForm";

export default function NewTicketPage() {
  return (
    <div className="wrap">
      <PageHeader
        title="New Ticket"
        subtitle="Submit a helpdesk request for citizen support."
        back="/helpdesk/tickets"
        backLabel="Tickets"
      />
      <NewTicketForm />
    </div>
  );
}
