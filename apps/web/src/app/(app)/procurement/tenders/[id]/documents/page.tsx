import { getProcurementTenderById } from "../../../../../_data/loaders";
import { getSessionRoles, hasAnyRole, PROCUREMENT_WRITE_ROLES } from "@/lib/auth/roleGuard";
import { PageHeader, ErrorState } from "../../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { TenderDocumentsClient } from "./TenderDocumentsClient";

/**
 * GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-02: this was a "use client" page that
 * only showed the raw UUID ("Tender ID: {params.id}"). It is now a server
 * wrapper that resolves the tender (tenderNo / title / status) and passes them
 * to the client component, so an officer can see WHICH tender — and whether it
 * is a safe draft or an already-published tender bidders can see — before
 * attaching documents.
 *
 * GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-01 (role gate): the upload form was
 * rendered unconditionally for any procurement-module user. The server now
 * computes canUpload from the session roles (mirrors procurement-service's
 * tender docs WRITE_ROLES) and only a writer sees the form; the service remains
 * the authority (POST .../documents 403s a non-writer).
 */
export default async function TenderDocumentsPage({ params }: { params: { id: string } }) {
  const { data: tender, source } = await getProcurementTenderById(params.id);
  const canUpload = hasAnyRole(getSessionRoles(), PROCUREMENT_WRITE_ROLES);

  if (!tender) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Tender Documents" back={`/procurement/tenders/${params.id}`} backLabel="Tender" />
        <ErrorState
          error={toHumanError(source === "error" ? "load" : "load", { area: "tender" })}
          backHref="/procurement/tenders"
        />
      </div>
    );
  }

  return (
    <TenderDocumentsClient
      tenderId={tender.id}
      tenderNo={tender.tenderNo}
      title={tender.title}
      status={tender.status}
      canUpload={canUpload}
    />
  );
}
