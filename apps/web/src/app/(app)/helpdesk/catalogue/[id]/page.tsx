import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { getCatalogueOffering } from "../../../../_data/loaders";
import { getSessionRoles, hasAnyRole, HELPDESK_ROLES } from "@/lib/auth/roleGuard";
import { formatMinutesDuration } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { RaiseRequestForm } from "./RaiseRequestForm";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: offering, source, status } = await getCatalogueOffering(params.id);

  // GAP-HELPDESK-CATALOGUE-DETAIL-01: a transient fetch failure must not read as
  // a 404 "page not found". Only a real 404 (or an ok response with no body)
  // calls notFound(); any other error shows a retryable error state.
  if (source === "error" && status !== 404) {
    return (
      <div className="wrap">
        <PageHeader title="Service details" back="/helpdesk/catalogue" backLabel="Catalogue" />
        <RefreshErrorState
          error={toHumanError("load", { area: "service details" })}
          backHref="/helpdesk/catalogue"
        />
      </div>
    );
  }
  if (!offering) notFound();

  // GAP-HELPDESK-CATALOGUE-DETAIL-04: the raw OLA / underpinning-contract table
  // is internal ITIL detail — role-gate it to helpdesk staff rather than show
  // it to every requester on a self-service page.
  const isHelpdeskStaff = hasAnyRole(getSessionRoles(), HELPDESK_ROLES);

  return (
    <div className="wrap">
      <PageHeader
        title={offering.name}
        subtitle={offering.description ?? "Raise a request for this service."}
        back="/helpdesk/catalogue"
        backLabel="Catalogue"
      />

      <div className="grid g-2">
        <div className="card pad">
          <div className="card-h"><h3>About this service</h3></div>
          <div className="fields">
            <div className="fld"><div className="fl">Category</div><div className="fv">{offering.category}</div></div>
            <div className="fld"><div className="fl">Default priority</div><div className="fv">{offering.defaultPriority}</div></div>
            {/* GAP-HELPDESK-CATALOGUE-DETAIL-04: plain-language approval wording */}
            <div className="fld"><div className="fl">Approval</div><div className="fv">{offering.approvalRequired ? "Needs approval before work starts" : "No approval needed"}</div></div>
            <div className="fld"><div className="fl">Fulfilment stages</div><div className="fv">{offering.fulfilmentStages.map((s) => s.name).join(" → ") || "None"}</div></div>
          </div>

          {offering.olas && offering.olas.length > 0 ? (
            <>
              {/* GAP-HELPDESK-CATALOGUE-DETAIL-04: "Expected turnaround" for everyone,
                  as plain minutes->days text; the raw OLA table is staff-only. */}
              <div className="card-h" style={{ marginTop: 16 }}><h3>Expected turnaround</h3></div>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {offering.olas.map((o) => (
                  <li key={o.id} style={{ fontSize: "0.875rem", marginBottom: 4 }}>
                    <strong>{o.name}</strong> — about {formatMinutesDuration(o.targetMinutes)}
                    {isHelpdeskStaff ? ` (${o.kind.toUpperCase()} via ${o.provider})` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div className="card pad">
          <div className="card-h"><h3>Raise a request</h3></div>
          {offering.status !== "active" ? (
            <EmptyState icon="🚫" title="Offering retired" message="This offering is no longer available for new requests." />
          ) : (
            <RaiseRequestForm
              offeringId={offering.id}
              schema={offering.requestFormSchema}
              defaultPriority={offering.defaultPriority}
            />
          )}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Link href="/helpdesk/catalogue/my-requests" className="btn ghost" style={{ minHeight: 40 }}>View my requests</Link>
      </div>
    </div>
  );
}
