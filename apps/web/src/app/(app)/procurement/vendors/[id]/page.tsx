import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState } from "../../../../_components/ds";
import { getProcurementVendorById } from "../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";

const EMPANELMENT_LABELS: Record<string, string> = {
  empanelled: "Empanelled",
  provisional: "Provisional",
  blacklisted: "Blacklisted",
  not_empanelled: "Not Empanelled",
};

export default async function VendorDetailPage({ params }: { params: { id: string } }) {
  const { data: vendor, source } = await getProcurementVendorById(params.id);

  if (!vendor) {
    // L3 fix: see indents/[id]/page.tsx — don't tell the officer a vendor is
    // "removed or invalid" when the real cause was a fetch error.
    return (
      <>
        <PageHeader title="Vendor Profile" back="/procurement/vendors" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "vendor" })} backHref="/procurement/vendors" />
        ) : (
          <EmptyState icon="🏢" title="Vendor not found" message="This vendor may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={vendor.name}
        subtitle={`${vendor.vendorCode} · ${vendor.category}`}
        back="/procurement/vendors"
        actions={
          <>
            <StatusPill status={vendor.empanelmentStatus} label={EMPANELMENT_LABELS[vendor.empanelmentStatus] ?? vendor.empanelmentStatus} />
            {vendor.rating !== undefined && (
              <span className="pill info">{vendor.rating}/5<span aria-hidden="true"> ★</span><span className="sr-only"> rating out of 5</span></span>
            )}
            <Link href={`/procurement/vendors/${vendor.id}/scorecard`} className="btn ghost">View scorecard</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <Card title="Vendor details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Vendor Code</span>
            <span className="mono">{vendor.vendorCode}</span>
          </div>
          <div className="field">
            <span className="label">Category</span>
            <span>{vendor.category}</span>
          </div>
          <div className="field">
            <span className="label">Empanelment</span>
            <StatusPill status={vendor.empanelmentStatus} label={EMPANELMENT_LABELS[vendor.empanelmentStatus] ?? vendor.empanelmentStatus} />
          </div>
          {vendor.gstin && (
            <div className="field">
              <span className="label">GSTIN</span>
              <span className="mono">{vendor.gstin}</span>
            </div>
          )}
          {vendor.panNo && (
            <div className="field">
              <span className="label">PAN</span>
              <span className="mono">{vendor.panNo}</span>
            </div>
          )}
          {vendor.contactPerson && (
            <div className="field">
              <span className="label">Contact Person</span>
              <span>{vendor.contactPerson}</span>
            </div>
          )}
          {vendor.email && (
            <div className="field">
              <span className="label">Email</span>
              <span>{vendor.email}</span>
            </div>
          )}
          {vendor.phone && (
            <div className="field">
              <span className="label">Phone</span>
              <span>{vendor.phone}</span>
            </div>
          )}
          {vendor.kycStatus && (
            <div className="field">
              <span className="label">KYC Status</span>
              <StatusPill status={vendor.kycStatus} label={vendor.kycStatus.charAt(0).toUpperCase() + vendor.kycStatus.slice(1)} />
            </div>
          )}
          {vendor.kycVerifiedAt && (
            <div className="field">
              <span className="label">KYC Verified At</span>
              <span>{String(vendor.kycVerifiedAt).slice(0, 10)}</span>
            </div>
          )}
          {vendor.address && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Address</span>
              <span>{vendor.address}</span>
            </div>
          )}
        </div>
      </Card>

      {(vendor.bankAccountNo || vendor.ifscCode) && (
        <Card title="Bank details" padding>
          <div className="fields">
            {vendor.bankAccountNo && (
              <div className="field">
                <span className="label">Account No</span>
                <span className="mono">{vendor.bankAccountNo}</span>
              </div>
            )}
            {vendor.ifscCode && (
              <div className="field">
                <span className="label">IFSC Code</span>
                <span className="mono">{vendor.ifscCode}</span>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
