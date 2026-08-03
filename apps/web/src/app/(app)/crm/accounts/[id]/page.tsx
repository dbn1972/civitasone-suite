import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, EmptyState, DataTable } from "../../../../_components/ds";
import { getCrmAccountAncestors, getCrmAccountChildren, getCrmAccounts } from "../../../../_data/loaders";
import { AccountParentForm } from "./AccountParentForm";

export default async function Page({ params }: { params: { id: string } }) {
  const [{ data: accounts, source }, { data: ancestors }, { data: children }] = await Promise.all([
    getCrmAccounts(),
    getCrmAccountAncestors(params.id),
    getCrmAccountChildren(params.id),
  ]);

  const account = accounts.find((a) => a.id === params.id);

  if (!account) {
    return (
      <>
        <PageHeader title="Account Detail" back="/crm/accounts" backLabel="Accounts" />
        {source === "error" && <DataSourceBadge source={source} />}
        <EmptyState icon="🏢" title="Account not found" message="This account does not exist or is no longer active." />
      </>
    );
  }

  // The API returns the parent chain nearest-first; read it root-first for a breadcrumb.
  const breadcrumb = [...ancestors].reverse();
  const parentName = ancestors[0]?.name ?? null;

  return (
    <>
      <PageHeader
        title={account.name}
        subtitle={account.industry ?? "CRM Account"}
        back="/crm/accounts"
        backLabel="Accounts"
        actions={
          <AccountParentForm
            accountId={account.id}
            accountName={account.name}
            currentParentId={account.parentId}
            options={accounts.filter((a) => a.id !== account.id)}
          />
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Account Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Name</div><div className="v">{account.name}</div></div>
              {account.industry ? (
                <div className="fld"><div className="l">Industry</div><div className="v">{account.industry}</div></div>
              ) : null}
              {account.website ? (
                <div className="fld">
                  <div className="l">Website</div>
                  <div className="v"><a href={account.website} rel="noreferrer noopener" target="_blank">{account.website}</a></div>
                </div>
              ) : null}
              <div className="fld"><div className="l">Reports to</div><div className="v">{parentName ?? "Top level"}</div></div>
              <div className="fld"><div className="l">Linked Contacts</div><div className="v">{account.contactCount}</div></div>
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h3>Child Accounts</h3></div>
            {children.length === 0 ? (
              <EmptyState icon="🌳" title="No child accounts" message="Attach another account to this one to build the hierarchy." />
            ) : (
              <DataTable
                columns={[{ key: "name", label: "Account" }]}
                rows={children.map((c) => ({ id: c.id, name: c.name }))}
                rowLinkKey="id"
                rowLinkPrefix="/crm/accounts/"
              />
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Reporting Line</h3></div>
            <div className="pad">
              {breadcrumb.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>This is a top-level account.</p>
              ) : (
                <ol aria-label="Parent accounts, root first" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {breadcrumb.map((node, index) => (
                    <li key={node.id} style={{ paddingLeft: index * 16, marginBottom: 6 }}>
                      <span aria-hidden="true" style={{ color: "var(--muted)", marginRight: 6 }}>
                        {index > 0 ? "└" : "●"}
                      </span>
                      <a href={`/crm/accounts/${node.id}`}>{node.name}</a>
                    </li>
                  ))}
                  <li style={{ paddingLeft: breadcrumb.length * 16, marginBottom: 6, fontWeight: 600 }}>
                    <span aria-hidden="true" style={{ color: "var(--muted)", marginRight: 6 }}>└</span>
                    {account.name}
                  </li>
                </ol>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h3>Contacts</h3></div>
            <div className="pad">
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
                {account.contactCount === 0
                  ? "No contacts are linked to this account yet."
                  : `${account.contactCount} contact${account.contactCount === 1 ? "" : "s"} linked to this account.`}
              </p>
              <a className="btn ghost" href={`/crm/contacts?search=${encodeURIComponent(account.name)}`} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                View contacts
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
