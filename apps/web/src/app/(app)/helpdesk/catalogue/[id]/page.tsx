import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, EmptyState } from "../../../../_components/ds";
import { getCatalogueOffering } from "../../../../_data/loaders";
import { RaiseRequestForm } from "./RaiseRequestForm";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: offering } = await getCatalogueOffering(params.id);
  if (!offering) notFound();

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
            <div className="fld"><div className="fl">Approval</div><div className="fv">{offering.approvalRequired ? "Maker-checker required" : "Auto-approved"}</div></div>
            <div className="fld"><div className="fl">Fulfilment stages</div><div className="fv">{offering.fulfilmentStages.map((s) => s.name).join(" → ") || "None"}</div></div>
          </div>

          {offering.olas && offering.olas.length > 0 ? (
            <>
              <div className="card-h" style={{ marginTop: 16 }}><h3>OLA / underpinning contracts</h3></div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {offering.olas.map((o) => (
                  <li key={o.id} style={{ fontSize: "0.875rem", marginBottom: 4 }}>
                    <strong>{o.name}</strong> — {o.kind.toUpperCase()} via {o.provider}, target {o.targetMinutes} min
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
