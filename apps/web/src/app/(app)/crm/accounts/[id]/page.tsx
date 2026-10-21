import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { getCrmAccount, getCrmAccountAncestors, getCrmAccountChildren } from "../../../../_data/loaders";
import { getSessionRoles, hasAnyRole, CRM_VERIFY_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { hierarchyState } from "./hierarchyState";
import { safeExternalUrl } from "@/lib/url";
import { AccountParentForm } from "./AccountParentForm";
import { AccountOwnerForm } from "./AccountOwnerForm";
import { Customer360Panel } from "../../../../_components/crm/Customer360Panel";
import { AccountRelationshipsEditor } from "../../../../_components/crm/AccountRelationshipsEditor";
import { ActivityFeed } from "../../../../_components/crm/ActivityFeed";
import { CommunicationLog } from "../../../../_components/crm/CommunicationLog";
import { AddressesEditor } from "../../../../_components/crm/AddressesEditor";
import { DocumentsPanel } from "../../../../_components/crm/DocumentsPanel";
import { DocumentAlertsView } from "../../../../_components/crm/DocumentAlertsView";

export default async function Page({ params }: { params: { id: string } }) {
  const t = await getTranslations("crmAccountDetail");
  const tOwner = await getTranslations("crmOwner");
  // The account is resolved by id over GET /v1/crm/accounts/:id, so a valid deep
  // link renders no matter where the account would sit in the capped list
  // (GAP-CRM-ACCOUNTS-DETAIL-01). A 404 from that endpoint is the authoritative
  // "does not exist (or was merged away)"; any other failure is a load failure
  // and offers a retry instead of falsely claiming the account is missing.
  const [accountResult, ancestorsResult, childrenResult] = await Promise.all([
    getCrmAccount(params.id),
    getCrmAccountAncestors(params.id),
    getCrmAccountChildren(params.id),
  ]);
  const { data: account } = accountResult;
  const { data: ancestors } = ancestorsResult;
  const { data: children } = childrenResult;
  const childState = hierarchyState(childrenResult);
  const ancestorState = hierarchyState(ancestorsResult);

  if (!account) {
    if (accountResult.status === 404) {
      return (
        <>
          <PageHeader title="Account Detail" back="/crm/accounts" backLabel="Accounts" />
          <EmptyState icon="🏢" title={t("notFoundTitle")} message={t("notFoundMessage")} />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Account Detail" back="/crm/accounts" backLabel="Accounts" />
        <RefreshErrorState error={toHumanError("load", { area: "account details" })} backHref="/crm/accounts" />
      </>
    );
  }

  // The API returns the parent chain nearest-first; read it root-first for a breadcrumb.
  const breadcrumb = [...ancestors].reverse();
  const parentName = ancestors[0]?.name ?? null;

  // Document verify/reject is an approval control restricted to CRM admins; the
  // server stays the authority (GAP-CRM-ACCOUNTS-DETAIL-02).
  const canVerify = hasAnyRole(getSessionRoles(), CRM_VERIFY_ROLES);

  // GAP-CRM-ACCOUNTS-DETAIL-05: never put a stored website straight into href.
  // A "javascript:"/"data:" value would execute on click and a bare domain
  // would become a relative in-app link. Render plain text when unsafe.
  const safeWebsite = safeExternalUrl(account.website);

  return (
    <>
      <PageHeader
        title={account.name}
        subtitle={account.industry ?? "CRM Account"}
        back="/crm/accounts"
        backLabel="Accounts"
        actions={
          <>
          {/* GAP-CRM-OPPORTUNITIES-NEW-02: start an opportunity already linked to this account. */}
          <Link className="btn" href={`/crm/opportunities/new?accountId=${encodeURIComponent(account.id)}`}>
            {t("newOpportunity")}
          </Link>
          <AccountParentForm
            accountId={account.id}
            accountName={account.name}
            currentParentId={account.parentId}
            currentParentName={account.parentId ? parentName : null}
            // GAP-CRM-ACCOUNTS-DETAIL-03: the parent picker searches server-side and
            // the server hides this account AND its descendants, so a move that
            // would create a cycle can't be selected (the 422 CYCLE_DETECTED stays
            // as a backstop). The size of the moving sub-tree comes from the
            // by-id response, not from a pre-loaded list.
            subtreeSize={account.descendantCount ?? 0}
          />
          </>
        }
      />
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
                  <div className="v">
                    {safeWebsite ? (
                      <a href={safeWebsite} rel="noreferrer noopener" target="_blank">{account.website}</a>
                    ) : (
                      <span>{account.website}</span>
                    )}
                  </div>
                </div>
              ) : null}
              <div className="fld"><div className="l">Reports to</div><div className="v">{parentName ?? "Top level"}</div></div>
              <div className="fld"><div className="l">Linked Contacts</div><div className="v">{account.contactCount}</div></div>
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h3>{tOwner("cardTitle")}</h3></div>
            {/* F5-01: change the owning agent. The picker resolves the current
                owner id to a name itself; the server audits the change. */}
            <AccountOwnerForm
              accountId={account.id}
              currentOwnerId={account.ownerId ?? null}
              currentOwnerName={null}
            />
          </div>

          <div className="card">
            <div className="card-h"><h3>Child Accounts</h3></div>
            {childState === "error" ? (
              <RefreshErrorState error={toHumanError("load", { area: "child accounts" })} backHref="/crm/accounts" />
            ) : childState === "empty" ? (
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
              {ancestorState === "error" ? (
                <RefreshErrorState error={toHumanError("load", { area: t("reportingLineArea") })} backHref="/crm/accounts" />
              ) : ancestorState === "empty" ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>This is a top-level account.</p>
              ) : (
                <ol aria-label="Parent accounts, root first" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {breadcrumb.map((node, index) => (
                    <li key={node.id} style={{ paddingInlineStart: index * 16, marginBottom: 6 }}>
                      <span aria-hidden="true" style={{ color: "var(--muted)", marginInlineEnd: 6 }}>
                        {index > 0 ? "└" : "●"}
                      </span>
                      <a href={`/crm/accounts/${node.id}`}>{node.name}</a>
                    </li>
                  ))}
                  <li style={{ paddingInlineStart: breadcrumb.length * 16, marginBottom: 6, fontWeight: 600 }}>
                    <span aria-hidden="true" style={{ color: "var(--muted)", marginInlineEnd: 6 }}>└</span>
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
              <a className="btn ghost" href={`/crm/contacts?accountId=${encodeURIComponent(account.id)}&accountName=${encodeURIComponent(account.name)}`} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                View contacts
              </a>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 18 }}>
        <Customer360Panel subjectType="account" subjectId={account.id} />
        <AccountRelationshipsEditor accountId={account.id} />
        <ActivityFeed subjectType="account" subjectId={account.id} />
        <CommunicationLog subjectType="account" subjectId={account.id} />
        <AddressesEditor ownerType="account" ownerId={account.id} />
        <DocumentAlertsView subjectType="account" subjectId={account.id} />
        <DocumentsPanel subjectType="account" subjectId={account.id} canVerify={canVerify} />
      </div>
    </>
  );
}
