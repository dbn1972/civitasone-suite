import { PageHeader, EmptyState, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { getCrmAccount, getCrmAccounts, getCrmAccountAncestors, getCrmAccountChildren } from "../../../../_data/loaders";
import { getSessionRoles, hasAnyRole, CRM_VERIFY_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { hierarchyState } from "./hierarchyState";
import { safeExternalUrl } from "@/lib/url";
import { collectDescendantIds } from "../hierarchy";
import { AccountParentForm } from "./AccountParentForm";
import { Customer360Panel } from "../../../../_components/crm/Customer360Panel";
import { AccountRelationshipsEditor } from "../../../../_components/crm/AccountRelationshipsEditor";
import { ActivityFeed } from "../../../../_components/crm/ActivityFeed";
import { CommunicationLog } from "../../../../_components/crm/CommunicationLog";
import { AddressesEditor } from "../../../../_components/crm/AddressesEditor";
import { DocumentsPanel } from "../../../../_components/crm/DocumentsPanel";
import { DocumentAlertsView } from "../../../../_components/crm/DocumentAlertsView";

export default async function Page({ params }: { params: { id: string } }) {
  const t = await getTranslations("crmAccountDetail");
  // The account is resolved by id (getCrmAccount queries the list at the server's
  // max page size, so accounts beyond the default 50-row page resolve) rather
  // than accounts.find() over the default page, which rendered a valid deep link
  // as "Account not found" (GAP-CRM-ACCOUNTS-DETAIL-01). The /ancestors endpoint
  // loads every tenant account and 404s on an unknown id, so it is the
  // authoritative existence signal: a null account + 404 ancestors is a real
  // "does not exist"; a null account + non-404 is a load failure, not a 404.
  const [accountResult, accountsResult, ancestorsResult, childrenResult] = await Promise.all([
    getCrmAccount(params.id),
    getCrmAccounts(),
    getCrmAccountAncestors(params.id),
    getCrmAccountChildren(params.id),
  ]);
  const { data: account } = accountResult;
  const { data: accounts } = accountsResult;
  const { data: ancestors } = ancestorsResult;
  const { data: children } = childrenResult;
  const childState = hierarchyState(childrenResult);
  const ancestorState = hierarchyState(ancestorsResult);

  // A genuine 404 from the authoritative ancestors endpoint → the account does
  // not exist, regardless of whether the (capped) list happened to include it.
  if (ancestorsResult.status === 404) {
    return (
      <>
        <PageHeader title="Account Detail" back="/crm/accounts" backLabel="Accounts" />
        <EmptyState icon="🏢" title={t("notFoundTitle")} message={t("notFoundMessage")} />
      </>
    );
  }

  // The account exists but neither the by-id lookup nor the hierarchy load
  // succeeded — a transient failure, not a 404. Offer a retry instead of
  // falsely claiming the account is missing.
  if (!account) {
    if (accountResult.source === "error" || ancestorsResult.source === "error") {
      return (
        <>
          <PageHeader title="Account Detail" back="/crm/accounts" backLabel="Accounts" />
          <RefreshErrorState error={toHumanError("load", { area: "account details" })} backHref="/crm/accounts" />
        </>
      );
    }
    // Loaded cleanly, exists per ancestors, but sits beyond the max page the
    // list endpoint can return. A true by-id endpoint removes this edge
    // (tracked as GAP-CRM-ACCOUNTS-DETAIL-03); until then, fail safe.
    return (
      <>
        <PageHeader title="Account Detail" back="/crm/accounts" backLabel="Accounts" />
        <EmptyState
          icon="🏢"
          title={t("unavailableTitle")}
          message={t("unavailableMessage")}
        />
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
          <AccountParentForm
            accountId={account.id}
            accountName={account.name}
            currentParentId={account.parentId}
            options={(() => {
              // GAP-CRM-ACCOUNTS-DETAIL-03: exclude the account itself AND its
              // descendants, so a move that would create a cycle can't even be
              // selected (the server 422 CYCLE_DETECTED stays as a backstop).
              const descendants = collectDescendantIds(accounts, account.id);
              return accounts.filter((a) => a.id !== account.id && !descendants.has(a.id));
            })()}
            subtreeSize={collectDescendantIds(accounts, account.id).size}
          />
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
        <AccountRelationshipsEditor accountId={account.id} accountOptions={accounts.map((a) => ({ id: a.id, name: a.name }))} />
        <ActivityFeed subjectType="account" subjectId={account.id} />
        <CommunicationLog subjectType="account" subjectId={account.id} />
        <AddressesEditor ownerType="account" ownerId={account.id} />
        <DocumentAlertsView subjectType="account" subjectId={account.id} />
        <DocumentsPanel subjectType="account" subjectId={account.id} canVerify={canVerify} />
      </div>
    </>
  );
}
