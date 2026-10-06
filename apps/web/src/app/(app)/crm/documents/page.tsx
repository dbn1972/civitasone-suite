import { useTranslations } from "next-intl";
import { PageHeader } from "../../../_components/ds";
import Link from "next/link";
import { getSessionRoles, hasAnyRole, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { DocumentRegister } from "./DocumentRegister";

/**
 * DM-001..003 — Documents workspace landing. Documents live on each record
 * (Accounts, Contacts, Opportunities, Quotations, Leads, Cases) via the
 * Documents panel; the type catalogue and its mandatory / expiry / verification
 * rules are configured under Document Types.
 *
 * GAP-CRM-DOCUMENTS-01: /crm/document-types is admin-only (its layout redirects
 * non-admins). The "Manage Document Types" control is therefore only shown to
 * CRM admins; a clerk sees guidance instead of a button that bounces them back.
 * The route guard remains the real enforcement — this is UX only.
 *
 * GAP-CRM-DOCUMENTS-02: a cross-record register now backs this page — a paged,
 * tenant-scoped view over crm-service's GET /v1/crm/documents/register with
 * filters for scan status, expiring-within-30-days and missing-mandatory. Each
 * row links to its subject record. The guidance below stays as orientation.
 */
export default function Page() {
  const t = useTranslations("crmDocumentsPage");
  const canManage = hasAnyRole(getSessionRoles(), CRM_ADMIN_ROLES);

  return (
    <>
      <PageHeader
        title="Documents"
        subtitle={t("subtitle")}
        back="/crm"
        backLabel="CRM"
      />
      <DocumentRegister />
      <div className="card">
        <div className="card-h"><h3>Where documents live</h3></div>
        <div className="pad" style={{ display: "grid", gap: 12, fontSize: 14 }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Documents are attached to individual records. Open an Account or Contact and use the
            <strong> Documents</strong> panel to upload files, track malware-scan status, keep version history,
            verify or reject a document, and see what is missing or expiring.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", display: "grid", gap: 6 }}>
            {canManage ? (
              <li>{t.rich("configureTypes", { link: (chunks) => <a href="/crm/document-types">{chunks}</a> })}</li>
            ) : (
              <li>{t("askAdminCatalogue")}</li>
            )}
            <li>Each record&rsquo;s Documents panel flags any mandatory type that is missing, and any document that has expired or expires within 30 days (configurable).</li>
            {/* GAP-CRM-DOCUMENTS-05: verified against crm-service — the download
                route is scan-gated secure-by-default: only scan_status='clean'
                is downloadable; an infected file returns 403 and a file still
                being scanned is withheld (409). There is no separate "quarantine"
                store, so the copy says "blocked from download" (what actually
                happens) rather than "quarantined". */}
            <li>A file that fails the malware scan is blocked from download automatically; a file is downloadable only once its scan comes back clean.</li>
          </ul>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn ghost" href="/crm/accounts">Go to Accounts</Link>
            <Link className="btn ghost" href="/crm/contacts">Go to Contacts</Link>
            {canManage ? (
              <a className="btn primary" href="/crm/document-types">{t("manageTypes")}</a>
            ) : (
              <span style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>
                {t("askAdminTypes")}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
