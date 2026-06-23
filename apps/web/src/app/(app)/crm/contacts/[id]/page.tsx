import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, EmptyState } from "../../../../_components/ds";
import { getContactById } from "../../../../_data/loaders";
import { ContactDetailActions } from "./ContactDetailActions";
import Link from "next/link";

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
              {contact.lastActivityDate && <div className="fld"><div className="l">Last Activity</div><div className="v">{contact.lastActivityDate}</div></div>}
              {contact.marketingConsent !== undefined && (
                <div className="fld"><div className="l">Marketing Consent</div><div className="v">{contact.marketingConsent ? "Yes" : "No"}</div></div>
              )}
            </div>
          </div>
          {contact.deals.length > 0 && (
            <div className="card">
              <div className="card-h"><h3>Related Deals</h3></div>
              <table className="tbl">
                <thead>
                  <tr><th>Deal Name</th><th>Stage</th><th>Amount (₹)</th></tr>
                </thead>
                <tbody>
                  {contact.deals.map((deal) => (
                    <tr key={deal.id} className="clickable">
                      <td><Link href={`/crm/deals/${deal.id}`}>{deal.dealName}</Link></td>
                      <td><StatusPill status={deal.stage} label={deal.stage.replace(/_/g, " ")} /></td>
                      <td className="num">₹{(deal.amount / 100).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
                      {a.dueDate && <div className="d">{a.dueDate}</div>}
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
