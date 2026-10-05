import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, EmptyState, DataTable, maskPhone, maskEmail } from "../../../../_components/ds";
import { getContactById } from "../../../../_data/loaders";
import { getSessionRoles, hasAnyRole, CRM_PII_READ_ROLES, CRM_VERIFY_ROLES } from "@/lib/auth/roleGuard";
import { formatIndianDate } from "@/lib/formatters";
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
  const { data: contact, source } = await getContactById(params.id);

  if (!contact) {
    return (
      <>
        <PageHeader title="Contact Detail" back="/crm/contacts" backLabel="Contacts" />
        {source === "error" && <DataSourceBadge source={source} />}
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
  const phoneDisplay = contact.phone ? (canViewPii ? contact.phone : maskPhone(contact.phone)) : null;
  const emailDisplay = contact.email ? (canViewPii ? contact.email : maskEmail(contact.email)) : null;

  const classificationTags: Array<{ label: string; value: string }> = [
    ...(contact.temperature ? [{ label: "Temperature", value: contact.temperature }] : []),
    ...(contact.priority ? [{ label: "Priority", value: contact.priority }] : []),
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
        actions={<ContactDetailActions contactId={contact.id} name={contact.name} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
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
              {contact.leadStatus && <div className="fld"><div className="l">Lead Status</div><div className="v">{contact.leadStatus}</div></div>}
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

          {contact.deals.length > 0 && (
            <div className="card">
              <div className="card-h"><h3>Related Deals</h3></div>
              <DataTable
                columns={[
                  { key: "dealName", label: "Deal Name" },
                  { key: "stage", label: "Stage", cellType: "status" },
                  { key: "amount", label: "Amount", align: "right", cellType: "amount" },
                ]}
                rows={contact.deals.map((deal) => ({
                  id: deal.id,
                  dealName: deal.dealName,
                  stage: deal.stage.replace(/_/g, " "),
                  amount: deal.amount,
                }))}
                rowLinkKey="id"
                rowLinkPrefix="/crm/deals/"
              />
            </div>
          )}
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
          {contact.activityTimeline.length > 0 && (
            <div className="card">
              <div className="card-h"><h3>Activity Timeline</h3></div>
              <div className="pad">
                <ul className="tl">
                  {contact.activityTimeline.map((a) => (
                    <li key={a.id} className={a.status === "completed" ? "done" : "cur"}>
                      <div className="t">{a.type} — {a.subject}</div>
                      {a.dueDate && <div className="d">{formatIndianDate(a.dueDate)}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
