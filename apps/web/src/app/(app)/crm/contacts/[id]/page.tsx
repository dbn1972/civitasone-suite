import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, EmptyState, DataTable } from "../../../../_components/ds";
import { getContactById } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { ContactDetailActions } from "./ContactDetailActions";
import { QualifyPanel } from "../../../../_components/crm/QualifyPanel";
import { ScoreHistoryView } from "../../../../_components/crm/ScoreHistoryView";
import { LeadTransitionControl } from "../../../../_components/crm/LeadTransitionControl";
import { LeadAssignmentControl } from "../../../../_components/crm/LeadAssignmentControl";
import { AssignmentLogView } from "../../../../_components/crm/AssignmentLogView";

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
              {contact.phone && <div className="fld"><div className="l">Phone</div><div className="v">{contact.phone}</div></div>}
              {contact.email && <div className="fld"><div className="l">Email</div><div className="v">{contact.email}</div></div>}
              {contact.city && <div className="fld"><div className="l">City</div><div className="v">{contact.city}</div></div>}
              {contact.leadStatus && <div className="fld"><div className="l">Lead Status</div><div className="v">{contact.leadStatus}</div></div>}
              {contact.expectedValueDisplay && <div className="fld"><div className="l">Expected Value</div><div className="v">{contact.expectedValueDisplay}</div></div>}
              {contact.lastActivityDate && <div className="fld"><div className="l">Last Activity</div><div className="v">{formatIndianDate(contact.lastActivityDate)}</div></div>}
              {contact.marketingConsent !== undefined && (
                <div className="fld"><div className="l">Marketing Consent</div><div className="v">{contact.marketingConsent ? "Yes" : "No"}</div></div>
              )}
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
