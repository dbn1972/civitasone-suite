import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { MergeButton } from "../../../_components/crm/MergeButton";
import type { MergeOption } from "../../../_components/crm/MergeDialog";
import { getCrmAccounts } from "../../../_data/loaders";
import { AccountsTable } from "./AccountsTable";
import { AccountHierarchy } from "./AccountHierarchy";
import { NewAccountForm } from "./NewAccountForm";
import { countSubsidiaries } from "./hierarchy";

export default async function Page() {
  const { data: accounts, source } = await getCrmAccounts();

  const totalContacts = accounts.reduce((sum, a) => sum + a.contactCount, 0);
  const subsidiaries = countSubsidiaries(accounts);

  // Never fabricate a 0 count when the list load failed — show "—" instead.
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  const mergeOptions: MergeOption[] = accounts.map((a) => ({
    id: a.id,
    label: a.industry ? `${a.name} · ${a.industry}` : a.name,
    fields: {
      Name: a.name,
      Industry: a.industry,
      Website: a.website,
      Contacts: String(a.contactCount),
    },
  }));

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Organisation master — departments, PSUs, vendors and institutional accounts with their reporting hierarchy • संगठन पंजी"
        back="/crm"
        backLabel="CRM"
        actions={<NewAccountForm accounts={accounts} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      {mergeOptions.length >= 2 ? <MergeButton entity="accounts" options={mergeOptions} label="Merge duplicate accounts" /> : null}
      <StatGrid>
        <StatCard icon="▣" iconBg="#eef2ff" label="Total Accounts" value={stat(accounts.length)} />
        <StatCard icon="◉" iconBg="#eef2ff" label="Subsidiary Accounts" value={stat(subsidiaries)} />
        <StatCard icon="◈" iconBg="#eef2ff" label="Linked Contacts" value={stat(totalContacts)} />
        <StatCard
          icon="△"
          iconBg="#eef2ff"
          label="Sectors / Ministries"
          value={stat(new Set(accounts.map((a) => a.industry).filter(Boolean)).size)}
        />
      </StatGrid>
      <AccountsTable accounts={accounts} source={source} />
      <AccountHierarchy accounts={accounts} />
    </>
  );
}
