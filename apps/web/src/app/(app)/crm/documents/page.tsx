import { PageHeader } from "../../../_components/ds";

/**
 * DM-001..003 — Documents workspace landing. Documents live on each record
 * (Accounts, Contacts, Opportunities, Quotations, Leads, Cases) via the
 * Documents panel; the type catalogue and its mandatory / expiry / verification
 * rules are configured under Document Types.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Documents"
        subtitle="Attachment management for CRM records — upload, version, malware-scan status, verification and expiry tracking."
        back="/crm"
        backLabel="CRM"
      />
      <div className="card">
        <div className="card-h"><h3>Where documents live</h3></div>
        <div className="pad" style={{ display: "grid", gap: 12, fontSize: 14 }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Documents are attached to individual records. Open an Account or Contact and use the
            <strong> Documents</strong> panel to upload files, track malware-scan status, keep version history,
            verify or reject a document, and see what is missing or expiring.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", display: "grid", gap: 6 }}>
            <li>Configure the document-type catalogue and its mandatory / expiry / verification rules under <a href="/crm/document-types">Document Types</a>.</li>
            <li>Each record&rsquo;s Documents panel flags any mandatory type that is missing, and any document that has expired or expires within 30 days.</li>
            <li>Infected files are quarantined automatically and can never be downloaded.</li>
          </ul>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn ghost" href="/crm/accounts">Go to Accounts</a>
            <a className="btn ghost" href="/crm/contacts">Go to Contacts</a>
            <a className="btn primary" href="/crm/document-types">Manage Document Types</a>
          </div>
        </div>
      </div>
    </>
  );
}
