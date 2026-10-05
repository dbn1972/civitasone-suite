import { getTranslations } from "next-intl/server";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { MergeButton } from "../../../_components/crm/MergeButton";
import type { MergeOption } from "../../../_components/crm/MergeDialog";
import { getCrmAccounts } from "../../../_data/loaders";
import { AccountsTable } from "./AccountsTable";
import { AccountHierarchy } from "./AccountHierarchy";
import { NewAccountForm } from "./NewAccountForm";
import { countSubsidiaries } from "./hierarchy";

export default async function Page() {
  const tl = await getTranslations("crm.accounts");
  const { data: accounts, source, truncated, pageLimit = 200, total = null } = await getCrmAccounts();

  const t = await getTranslations("crmAccountsPage");
  const totalContacts = accounts.reduce((sum, a) => sum + a.contactCount, 0);
  const subsidiaries = countSubsidiaries(accounts);

  // Never fabricate a 0 count when the list load failed — show "—" instead.
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  // GAP-CRM-ACCOUNTS-02: the endpoint is page-capped and returns no total, so
  // when the page is full these counts are of the loaded page only, not the
  // whole master. Say so rather than present a page count as the total.
  const partialSuffix = (base: string) => (source !== "error" && truncated ? t("partialSuffix", { label: base }) : base);

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
        subtitle={tl("subtitle")}
        back="/crm"
        backLabel="CRM"
        actions={<NewAccountForm accounts={accounts} />}
      />
      {/* UX-012: the data-source badge now lives inside AccountsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). The `stat()`
          "—" fallback above is unrelated and unchanged. */}
      {mergeOptions.length >= 2 ? <MergeButton entity="accounts" options={mergeOptions} label="Merge duplicate accounts" /> : null}
      <StatGrid>
        <StatCard icon="▣" iconBg="#eef2ff" label={total !== null && truncated ? t("totalAccounts") : partialSuffix(t("totalAccounts"))} value={source === "error" ? "—" : (total !== null ? total.toLocaleString("en-IN") : stat(accounts.length))} />
        <StatCard icon="◉" iconBg="#eef2ff" label={partialSuffix(t("subsidiaryAccounts"))} value={stat(subsidiaries)} />
        <StatCard icon="◈" iconBg="#eef2ff" label={partialSuffix(t("linkedContacts"))} value={stat(totalContacts)} />
        <StatCard
          icon="△"
          iconBg="#eef2ff"
          label={partialSuffix(t("sectorsMinistries"))}
          value={stat(new Set(accounts.map((a) => a.industry).filter(Boolean)).size)}
        />
      </StatGrid>
      {source !== "error" && truncated ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0" }}>
          {total !== null
            ? t("showingOf", { shown: accounts.length.toLocaleString("en-IN"), total: total.toLocaleString("en-IN") })
            : t("showingFirst", { limit: pageLimit.toLocaleString("en-IN") })}
        </p>
      ) : null}
      <AccountsTable accounts={accounts} source={source} />
      <AccountHierarchy accounts={accounts} source={source} />
    </>
  );
}
