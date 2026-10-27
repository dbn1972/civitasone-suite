import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, Masked } from "../../../../_components/ds";
import { maskPan, maskPhone, maskEmail } from "../../../../_components/ds/Masked";
import { getProcurementVendorById, getProcurementPOs, getProcurementGRNs, getVendorEmd, getVendorPbg } from "../../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { VendorActions } from "./VendorActions";
import { VendorOrdersTable, type VendorPoRow } from "./VendorOrdersTable";
import { VendorGrnsTable, VendorSecuritiesTable } from "./VendorHistoryTables";
import { GRN_STATUS_LABELS } from "../../grn/statusLabels";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, formatMoney, todayIST } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, PROCUREMENT_WRITE_ROLES } from "@/lib/auth/roleGuard";

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
  return (KYC_LABELS[status] ?? status
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase()));
}

/** Whole days from `today` to `isoDate` (both YYYY-MM-DD); negative once past. */
function daysUntil(isoDate: string, today: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
const EXPIRY_WARN_DAYS = 30;

// GAP-PROCUREMENT-VENDORS-02: audited reveal of masked vendor PII. The roles
// mirror procurement-service's REVEALABLE_VENDOR_FIELDS (the server is the
// authority and re-checks): contact channels for procurement staff, the PAN for
// admins and auditors only.
const VENDOR_REVEAL_PATH = "v1/procurement/pii/reveal";
const VENDOR_PAN_REVEAL_ROLES = ["procurement_admin", "super_admin", "audit_officer"];
const GRN_HISTORY_LIMIT = 50;

export default async function VendorDetailPage(
  props: { params: Promise<{ id: string }>; searchParams?: Promise<{ registered?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const t = await getTranslations("procurement.w2.vendorDetail");
  // GAP-PROCUREMENT-VENDORS-DETAIL-04: the vendor's own purchase orders, fetched
  // alongside the profile. Each section reports its own failure - an error is
  // never rendered as "no orders".
  const [{ data: vendor, source }, orders, grns, emd, pbg] = await Promise.all([
    getProcurementVendorById(params.id),
    getProcurementPOs({ vendorId: params.id, limit: 50 }),
    getProcurementGRNs({ vendorId: params.id, limit: GRN_HISTORY_LIMIT }),
    getVendorEmd(params.id),
    getVendorPbg(params.id),
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
  // account number are masked for everyone by default (the raw value never
  // reaches the client payload). GAP-PROCUREMENT-VENDORS-02: a viewer holding a
  // reveal role gets a "Reveal" control that asks for a reason and calls the
  // server's audited POST /v1/procurement/pii/reveal; the clear value only
  // exists after the server has written its audit event. The bank account stays
  // write-only (no reveal). GSTIN and IFSC stay visible - public business
  // identifiers, not personal/financial secrets.
  const roles = getSessionRoles();
  const canRevealContact = hasAnyRole(roles, PROCUREMENT_WRITE_ROLES);
  const canRevealPan = hasAnyRole(roles, VENDOR_PAN_REVEAL_ROLES);
  const revealCfg = (field: string, label: string, canReveal: boolean) => ({
    canReveal,
    resourceType: "vendor" as const,
    resourceId: vendor.id,
    field,
    label,
    revealPath: VENDOR_REVEAL_PATH,
  });
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
            {/* D4c #23: the single vendor rating scale is the scorecard score out of 100 with its band. */}
            {vendor.performanceScore != null ? (
              <span className="pill info" title={t("performanceScoreHint")}>
                {t("performanceScore", { score: vendor.performanceScore, band: vendor.performanceBand ?? "—" })}
              </span>
            ) : (
              <span className="pill" title={t("performanceScoreHint")}>{t("notScoredYet")}</span>
            )}
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
              <Masked value={maskPan(vendor.panNo)} kind="pan" className="mono" ariaLabel="PAN, masked" onReveal={revealCfg("pan", t("labelPan"), canRevealPan)} />
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
              <Masked value={maskEmail(vendor.email)} kind="email" className="mono" ariaLabel="Email, masked" onReveal={revealCfg("email", t("labelEmail"), canRevealContact)} />
            </div>
          )}
          {vendor.phone && (
            <div className="field">
              <span className="label">Phone</span>
              <Masked value={maskPhone(vendor.phone)} kind="phone" className="mono" ariaLabel="Phone, masked" onReveal={revealCfg("phone", t("labelPhone"), canRevealContact)} />
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

      {/* GAP-PROCUREMENT-VENDORS-DETAIL-04: orders, GRN and EMD/BG history, each filtered by vendor on the
          server and each reporting its own failure - an error is never rendered as "none". */}
      <Card title={t("ordersTitle")} padding>
        {orders.source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "vendor orders" })} backHref={`/procurement/vendors/${vendor.id}`} />
        ) : orders.data.length === 0 ? (
          <EmptyState icon="🧾" title={t("noOrders")} message={t("noOrdersHint")} />
        ) : (
          <VendorOrdersTable
            rows={orders.data.map((po): VendorPoRow => ({
              id: po.id,
              poNo: po.poNo,
              orderDateDisplay: po.orderDate ? formatIndianDate(po.orderDate) : "—",
              status: po.status,
              amountDisplay: formatMoney(po.amount),
            }))}
          />
        )}
      </Card>

      <Card title={t("grnsTitle")} padding>
        {grns.source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "vendor goods receipts" })} backHref={`/procurement/vendors/${vendor.id}`} />
        ) : grns.data.length === 0 ? (
          <EmptyState icon="📦" title={t("noGrns")} message={t("noGrnsHint")} />
        ) : (
          <>
            <VendorGrnsTable
              rows={grns.data.map((g) => ({
                id: g.id,
                grnNo: g.grnNo,
                receivedDisplay: g.receivedDate ? formatIndianDate(g.receivedDate) : "—",
                status: g.status,
                statusLabel: GRN_STATUS_LABELS[g.status] ?? g.status.replace(/_/g, " "),
              }))}
            />
            {grns.data.length >= GRN_HISTORY_LIMIT ? (
              <p role="note" style={{ fontSize: 13, color: "var(--warn)", margin: "10px 0 0" }}>
                {t("grnsShowingFirst", { count: GRN_HISTORY_LIMIT })}{" "}
                <Link href="/procurement/grn">{t("viewAllGrns")}</Link>
              </p>
            ) : null}
          </>
        )}
      </Card>

      <Card title={t("securitiesTitle")} padding>
        {emd.source === "error" || pbg.source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "vendor EMD and bank guarantees" })} backHref={`/procurement/vendors/${vendor.id}`} />
        ) : emd.data.length + pbg.data.length === 0 ? (
          <EmptyState icon="🛡️" title={t("noSecurities")} message={t("noSecuritiesHint")} />
        ) : (
          <VendorSecuritiesTable
            rows={[...emd.data, ...pbg.data].map((r) => ({
              id: `${r.kind}-${r.id}`,
              kind: r.kind,
              ref: r.ref,
              instrument: r.instrument,
              amountDisplay: formatMoney(r.amountMinor),
              validUntilDisplay: r.validUntil ? formatIndianDate(r.validUntil) : "—",
              status: r.status,
            }))}
          />
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
