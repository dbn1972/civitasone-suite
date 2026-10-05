"use client";
/**
 * NewOpportunityClient — client wrapper for the OP-003 create form.
 *
 * GAP-CRM-OPPORTUNITIES-NEW-01: on a successful create the plain form previously
 * stayed filled and stationary, so a second Create click POSTed a duplicate deal. This
 * wrapper passes an `onSaved` that navigates to the pipeline board (`/crm/opportunities`)
 * once the new id is known, so the completed form is left behind and cannot be
 * resubmitted. If the id can't be read for any reason, the form's own `saved` latch
 * still blocks a second submit and offers "Create another".
 *
 * GAP-CRM-OPPORTUNITIES-NEW-02: an `accountId` query param pre-links the opportunity to
 * an account (e.g. "+ New opportunity" launched from an account page).
 */
import { useRouter, useSearchParams } from "next/navigation";
import { OpportunityForm } from "../../../../_components/crm/OpportunityForm";

export function NewOpportunityClient() {
  const router = useRouter();
  const params = useSearchParams();
  const accountId = params.get("accountId") ?? undefined;

  return (
    <OpportunityForm
      {...(accountId ? { initialAccountId: accountId } : {})}
      onSaved={(id) => {
        router.push(id ? `/crm/opportunities?created=${encodeURIComponent(id)}` : "/crm/opportunities");
      }}
    />
  );
}
