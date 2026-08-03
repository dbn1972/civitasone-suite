import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmAccounts } from "../../../_data/loaders";
import { AccountsTable } from "./AccountsTable";
import { AccountHierarchy } from "./AccountHierarchy";
import { NewAccountForm } from "./NewAccountForm";
import { countSubsidiaries } from "./hierarchy";

export default async function Page() {
  const { data: accounts, source } = await getCrmAccounts();

  const totalContacts = accounts.reduce((sum, a) => sum + a.contactCount, 0);
  const subsidiaries = countSubsidiaries(accounts);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Organisation master — departments, PSUs, vendors and institutional customers with their reporting hierarchy."
        back="/crm"
        backLabel="CRM"
        actions={<NewAccountForm accounts={accounts} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Total Accounts" value={accounts.length.toLocaleString("en-IN")} />
        <StatCard icon="🌳" iconBg="#eef2ff" label="Subsidiary Accounts" value={subsidiaries.toLocaleString("en-IN")} />
        <StatCard icon="👤" iconBg="#eef2ff" label="Linked Contacts" value={totalContacts.toLocaleString("en-IN")} />
        <StatCard
          icon="🏭"
          iconBg="#eef2ff"
          label="Industries Covered"
          value={new Set(accounts.map((a) => a.industry).filter(Boolean)).size.toLocaleString("en-IN")}
        />
      </StatGrid>
      <AccountsTable accounts={accounts} source={source} />
      <AccountHierarchy accounts={accounts} />
    </>
  );
}
