import { PageHeader } from "../../../../_components/ds";
import { NewInternalTicketForm } from "./NewInternalTicketForm";

export default function NewInternalTicketPage() {
  return (
    <div className="wrap">
      <PageHeader
        title="New Internal Ticket"
        subtitle="Log a staff operations ticket in the internal helpdesk queue."
        back="/helpdesk/internal"
        backLabel="Internal Helpdesk"
      />
      <NewInternalTicketForm />
    </div>
  );
}
