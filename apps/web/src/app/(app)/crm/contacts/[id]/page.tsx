import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState, maskPhone, maskEmail } from "../../../../_components/ds";
import { LoadErrorState } from "../../../../_components/ds/LoadErrorState";
import { getContactById } from "../../../../_data/loaders";
import { getSessionRoles, hasAnyRole, CRM_PII_READ_ROLES, CRM_VERIFY_ROLES, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/crm/leadQualification";
import { ContactDetailActions } from "./ContactDetailActions";
import { QualifyPanel } from "../../../../_components/crm/QualifyPanel";
import { ScoreHistoryView } from "../../../../_components/crm/ScoreHistoryView";
import { LeadTransitionControl } from "../../../../_components/crm/LeadTransitionControl";
import { LeadAssignmentControl } from "../../../../_components/crm/LeadAssignmentControl";
import { AssignmentLogView } from "../../../../_components/crm/AssignmentLogView";
import { Customer360Panel } from "../../../../_components/crm/Customer360Panel";
import { ActivityFeed } from "../../../../_components/crm/ActivityFeed";
import { CommunicationLog } from "../../../../_components/crm/CommunicationLog";
import { AddressesEditor } from "../../../../_components/crm/AddressesEditor";
import { ContactRolesEditor } from "../../../../_components/crm/ContactRolesEditor";
import { DocumentsPanel } from "../../../../_components/crm/DocumentsPanel";
import { DocumentAlertsView } from "../../../../_components/crm/DocumentAlertsView";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: contact, source, status, errorMessage } = await getContactById(params.id);

  if (!contact) {
    // GAP-CRM-CONTACTS-DETAIL-05: a failed fetch (5xx/network/403) and a real
    // 404 used to render the SAME "Contact not found" with only a tiny badge.
    // Only a genuine 404 is "not found"; anything else is a transient failure
    // that must offer Retry (and a 403 its own access-restricted copy).
    if (source === "error" && status !== 404) {
      const tErr = await getTranslations("crmContactDetailPage");
      return (
        <>
          <PageHeader title={tErr("title")} back="/crm/contacts" backLabel={tErr("backLabel")} />
          <LoadErrorState result={{ status, errorMessage }} area={tErr("loadArea")} backHref="/crm/contacts" backLabel={tErr("backLabel")} />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Contact Detail" back="/crm/contacts" backLabel="Contacts" />
        <EmptyState icon="👤" title="Contact not found" message="This contact does not exist or has been removed." />
      </>
    );
  }

  // GAP-CRM-CONTACTS-DETAIL-02: DPDP — mask phone/email unless the role may
  // read PII. Computed server-side from the session.
  const canViewPii = hasAnyRole(getSessionRoles(), CRM_PII_READ_ROLES);
  // Document verify/reject is an approval control restricted to CRM admins
  // (GAP-CRM-ACCOUNTS-DETAIL-02); the server stays the authority.
  const canVerify = hasAnyRole(getSessionRoles(), CRM_VERIFY_ROLES);
  // GAP-CRM-CONTACTS-DETAIL-03: Delete is admin-only server-side (crm-service
  // DELETE requires crm_admin|super_admin). Hide the control from roles that
  // would only get a 403 after typing a deletion reason; server stays authority.
  const canDelete = hasAnyRole(getSessionRoles(), CRM_ADMIN_ROLES);
  const phoneDisplay = contact.phone ? (canViewPii ? contact.phone : maskPhone(contact.phone)) : null;
  const emailDisplay = contact.email ? (canViewPii ? contact.email : maskEmail(contact.email)) : null;

  // GAP-CRM-CONTACTS-DETAIL-07: humanize the raw enum values (hot/high/…) so the
  // detail page reads like the forms ("Hot", "High") rather than lower-case enums.
  const classificationTags: Array<{ label: string; value: string }> = [
    ...(contact.temperature ? [{ label: "Temperature", value: humanizeStatus(contact.temperature) }] : []),
    ...(contact.priority ? [{ label: "Priority", value: humanizeStatus(contact.priority) }] : []),
    ...(contact.segment ? [{ label: "Segment", value: contact.segment }] : []),
    ...(contact.product ? [{ label: "Product", value: contact.product }] : []),
    ...(contact.region ? [{ label: "Region", value: contact.region }] : []),
  ];

  return (
    <>
      <PageHeader
        title={contact.name}
        subtitle={contact.designation ?? contact.organization ?? "CRM Contact"}
        back="/crm/contacts"
        backLabel="Contacts"
        actions={<ContactDetailActions contactId={contact.id} name={contact.name} canDelete={canDelete} />}
      />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Contact Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Name</div><div className="v">{contact.name}</div></div>
              {contact.designation && <div className="fld"><div className="l">Designation</div><div className="v">{contact.designation}</div></div>}
              {contact.organization && <div className="fld"><div className="l">Organisation</div><div className="v">{contact.organization}</div></div>}
              {phoneDisplay && <div className="fld"><div className="l">Phone</div><div className="v">{phoneDisplay}</div></div>}
              {emailDisplay && <div className="fld"><div className="l">Email</div><div className="v">{emailDisplay}</div></div>}
              {contact.city && <div className="fld"><div className="l">City</div><div className="v">{contact.city}</div></div>}
              {/* GAP-CRM-CONTACTS-DETAIL-07: show the canonical label ("Disqualified"),
                  not the raw enum ("disqualified"), matching the list and forms. */}
              {contact.leadStatus && <div className="fld"><div className="l">Lead Status</div><div className="v">{LEAD_STATUS_LABELS[contact.leadStatus as LeadStatus] ?? humanizeStatus(contact.leadStatus)}</div></div>}
              {contact.expectedValueDisplay && <div className="fld"><div className="l">Expected Value</div><div className="v">{contact.expectedValueDisplay}</div></div>}
              {contact.lastActivityDate && <div className="fld"><div className="l">Last Activity</div><div className="v">{formatIndianDate(contact.lastActivityDate)}</div></div>}
              {/* GAP-CRM-CONTACTS-DETAIL-02: the bare Yes/No marketing-consent
                  row was removed — DPDP consent (with its captured date, and
                  purpose/source once the backend sends them) is shown in the
                  Customer360 consent block below, so this duplicate is dropped. */}
            </div>
          </div>

          {classificationTags.length > 0 && (
            <div className="card">
              <div className="card-h"><h3>Classification &amp; segmentation</h3></div>
              <div className="pad" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {classificationTags.map((t) => (
                  <span key={t.label} className="pill info">{t.label}: {t.value}</span>
                ))}
              </div>
            </div>
          )}

          <QualifyPanel leadId={contact.id} />

          <Customer360Panel subjectType="contact" subjectId={contact.id} />
          <ActivityFeed subjectType="contact" subjectId={contact.id} />
          <CommunicationLog subjectType="contact" subjectId={contact.id} />
          <AddressesEditor ownerType="contact" ownerId={contact.id} />
          <ContactRolesEditor contactId={contact.id} />
          <DocumentAlertsView subjectType="contact" subjectId={contact.id} />
          <DocumentsPanel subjectType="contact" subjectId={contact.id} canVerify={canVerify} />

          {/* GAP-CRM-CONTACTS-DETAIL-04: the page-level "Related Deals" card
              (from contact.deals) was removed — Customer360Panel above renders
              the richer Deals block (links to /crm/deals/{id}, handles
              error/empty, and shows quotations) from the 360 aggregate, so the
              two could disagree. Single source of truth is the 360 panel. */}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <LeadTransitionControl leadId={contact.id} currentStatus={contact.leadStatus ?? "new"} />
          <LeadAssignmentControl leadId={contact.id} />
          <AssignmentLogView leadId={contact.id} />
          <ScoreHistoryView leadId={contact.id} />
          {contact.tags.length > 0 && (
            <div className="card">
              <div className="card-h"><h3>Tags</h3></div>
              <div className="pad" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {contact.tags.map((t) => <span key={t} className="pill info">{t}</span>)}
              </div>
            </div>
          )}
          {/* GAP-CRM-CONTACTS-DETAIL-04: the page-level "Activity Timeline"
              card (from contact.activityTimeline) was removed — the
              ActivityFeed panel above is the single source of truth for
              activity, so the two payloads can no longer disagree. */}
        </div>
      </div>
    </>
  );
}
