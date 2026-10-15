import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, Masked } from "../../../../_components/ds";
import { getProcurementVendorById, getProcurementPOs } from "../../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { VendorActions } from "./VendorActions";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, formatMoney, todayIST } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, PROCUREMENT_APPROVER_ROLES, PROCUREMENT_WRITE_ROLES } from "@/lib/auth/roleGuard";

const EMPANELMENT_LABELS: Record<string, string> = {
  empanelled: "Empanelled",
  provisional: "Provisional",
  blacklisted: "Blacklisted",
  not_empanelled: "Not Empanelled",
};

// GAP-...-DETAIL-03: KYC status labels — a raw "in_progress" must not render
// as "In_progress". Known statuses get a proper label; unknown ones fall back
// to underscore→space + title-case.
const KYC_LABELS: Record<string, string> = {
  verified: "Verified",
  pending: "Pending",
  in_progress: "In progress",
  rejected: "Rejected",
  expired: "Expired",
  not_started: "Not started",
};
function kycLabel(status: string): string {
  return (
    KYC_LABELS[status] ??
    status
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

/** Whole days from `today` to `isoDate` (both YYYY-MM-DD); negative once past. */
function daysUntil(isoDate: string, today: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
const EXPIRY_WARN_DAYS = 30;

export default async function VendorDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { registered?: string } }) {
  const t = await getTranslations("procurement.w2.vendorDetail");
  // GAP-PROCUREMENT-VENDORS-DETAIL-04: the vendor's own purchase orders, fetched
  // alongside the profile. Each section reports its own failure - an error is
  // never rendered as "no orders".
  const [{ data: vendor, source }, orders] = await Promise.all([
    getProcurementVendorById(params.id),
    getProcurementPOs({ vendorId: params.id, limit: 50 }),
  ]);

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

  // GAP-...-DETAIL-01: DPDP / financial-data. PAN, email, phone and the bank
  // account number are masked for everyone by default (safe default: the raw
  // value never reaches the client payload). An audited, role-gated reveal is
  // a backend follow-up (POST /vendors/:id/reveal — see HUMAN REVIEW): until
  // that audited endpoint exists we FAIL CLOSED and show no reveal control, so
  // no unaudited clear value is ever emitted. GSTIN and IFSC stay visible —
  // they are public business identifiers, not personal/financial secrets.
  const canReveal = hasAnyRole(getSessionRoles(), PROCUREMENT_APPROVER_ROLES);
  // Reserved for the future audited-reveal wiring; referenced to avoid an
  // unused-var lint while the control itself is intentionally not rendered yet.
  void canReveal;
  // GAP-PROCUREMENT-VENDORS-DETAIL-02: lifecycle actions for procurement writers only.
  const canManage = hasAnyRole(getSessionRoles(), PROCUREMENT_WRITE_ROLES);
  const today = todayIST();
  const daysLeft = vendor.empanelmentValidTill ? daysUntil(vendor.empanelmentValidTill, today) : null;

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
              <span className="pill info" title="Buyer rating (1–5). The scorecard shows a separate performance score out of 100.">Buyer rating {vendor.rating}/5<span aria-hidden="true"> ★</span><span className="sr-only"> buyer rating out of 5</span></span>
            )}
            <Link href={`/procurement/vendors/${vendor.id}/scorecard`} className="btn ghost">View scorecard</Link>
            <VendorActions
              vendorId={vendor.id}
              empanelmentStatus={vendor.empanelmentStatus}
              lapsed={vendor.empanelmentLapsed}
              canManage={canManage}
            />
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      {/* GAP-PROCUREMENT-VENDORS-NEW-03: post-registration confirmation with
          the honest initial status, shown on the profile the user lands on. */}
      {searchParams?.registered === "1" ? (
        <div role="status" className="card pad" style={{ borderInlineStart: "4px solid var(--good)", marginBottom: 16 }}>
          <strong>Vendor registered.</strong>{" "}
          Status: {EMPANELMENT_LABELS[vendor.empanelmentStatus] ?? vendor.empanelmentStatus}
          {vendor.empanelmentStatus !== "empanelled"
            ? " — complete KYC and empanelment before ordering."
            : "."}
        </div>
      ) : null}

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
          {/* GAP-...-DETAIL-05: empanelment status is already shown as the
              header StatusPill — don't duplicate it here. */}
          {/* GAP-PROCUREMENT-VENDORS-DETAIL-04: empanelment validity with an expiry pill. */}
          {vendor.empanelmentValidTill ? (
            <div className="field">
              <span className="label">{t("validTill")}</span>
              <span>
                {formatIndianDate(vendor.empanelmentValidTill)}{" "}
                {vendor.empanelmentLapsed || (daysLeft !== null && daysLeft < 0)
                  ? <span className="pill bad">{t("expired")}</span>
                  : daysLeft !== null && daysLeft <= EXPIRY_WARN_DAYS
                    ? <span className="pill warn">{t("expiresIn", { days: daysLeft })}</span>
                    : null}
              </span>
            </div>
          ) : vendor.empanelmentLapsed ? (
            <div className="field">
              <span className="label">{t("validTill")}</span>
              <span className="pill bad">{t("expired")}</span>
            </div>
          ) : null}
          {vendor.gstin && (
            <div className="field">
              <span className="label">GSTIN</span>
              <span className="mono">{vendor.gstin}</span>
            </div>
          )}
          {vendor.panNo && (
            <div className="field">
              <span className="label">PAN</span>
              <Masked value={vendor.panNo} kind="pan" className="mono" ariaLabel="PAN, masked" />
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
              <Masked value={vendor.email} kind="email" className="mono" ariaLabel="Email, masked" />
            </div>
          )}
          {vendor.phone && (
            <div className="field">
              <span className="label">Phone</span>
              <Masked value={vendor.phone} kind="phone" className="mono" ariaLabel="Phone, masked" />
            </div>
          )}
          {vendor.kycStatus && (
            <div className="field">
              <span className="label">KYC Status</span>
              <StatusPill status={vendor.kycStatus} label={kycLabel(vendor.kycStatus)} />
            </div>
          )}
          {vendor.kycVerifiedAt && (
            <div className="field">
              <span className="label">KYC Verified At</span>
              <span>{formatIndianDate(vendor.kycVerifiedAt)}</span>
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

      {/* GAP-PROCUREMENT-VENDORS-DETAIL-04: orders history. GRNs, contracts and EMD/BG
          are still reached from their own registers (they need a vendor filter
          on their list endpoints). */}
      <Card title={t("ordersTitle")} padding>
        {orders.source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "vendor orders" })} backHref={`/procurement/vendors/${vendor.id}`} />
        ) : orders.data.length === 0 ? (
          <EmptyState icon="🧾" title={t("noOrders")} message={t("noOrdersHint")} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">{t("colPo")}</th>
                  <th scope="col">{t("colDate")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col" style={{ textAlign: "end" }}>{t("colAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.map((po) => (
                  <tr key={po.id}>
                    <td><Link href={`/procurement/orders/${po.id}`} className="mono">{po.poNo}</Link></td>
                    <td>{po.orderDate ? formatIndianDate(po.orderDate) : "—"}</td>
                    <td><StatusPill status={po.status} label={po.status.replace(/_/g, " ")} /></td>
                    <td className="mono" style={{ textAlign: "end" }}>{formatMoney(po.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(vendor.bankAccountNo || vendor.ifscCode) && (
        <Card title="Bank details" padding>
          <div className="fields">
            {vendor.bankAccountNo && (
              <div className="field">
                <span className="label">Account No</span>
                <Masked value={vendor.bankAccountNo} kind="account" className="mono" ariaLabel="Bank account number, masked" />
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
