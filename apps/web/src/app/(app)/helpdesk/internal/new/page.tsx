import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles, hasAnyRole, HELPDESK_ROLES } from "@/lib/auth/roleGuard";
import { NewInternalTicketForm } from "./NewInternalTicketForm";

export default function NewInternalTicketPage() {
  // GAP-HELPDESK-INTERNAL-NEW-01: gate the form to helpdesk roles — a plain
  // citizen gets a 403 from the endpoint, so the UI must not let them fill
  // the whole form only to fail on submit.
  const sessionRoles = getSessionRoles();
  if (!hasAnyRole(sessionRoles, HELPDESK_ROLES)) {
    return (
      <PermissionDenied
        module="internal helpdesk"
        requiredRoles={HELPDESK_ROLES}
        backHref="/helpdesk/internal"
        backLabel="Back to Internal Helpdesk"
      />
    );
  }

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
