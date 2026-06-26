import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmContacts } from "../../../_data/loaders";
import { ContactToolbar } from "./ContactToolbar";
import { ContactsTable } from "./ContactsTable";

export default async function Page({ searchParams }: { searchParams?: { search?: string; segment?: string } }) {
  const { data: contacts, source } = await getCrmContacts({
    search: searchParams?.search,
    segment: searchParams?.segment,
  });

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Vendor, beneficiary, NGO, and government official contacts — tenant-scoped contact master."
        back="/crm"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <ContactToolbar />
      <StatGrid>
        <StatCard icon="👤" iconBg="#eef2ff" label="Total Contacts" value={contacts.length.toLocaleString("en-IN")} />
        <StatCard icon="🏢" iconBg="#eef2ff" label="With Organisation" value={contacts.filter(c => c.account && c.account !== "—").length.toLocaleString("en-IN")} />
        <StatCard icon="📞" iconBg="#eef2ff" label="With Phone" value={contacts.filter(c => c.phone).length.toLocaleString("en-IN")} />
        <StatCard icon="✉️" iconBg="#eef2ff" label="With Email" value={contacts.filter(c => c.email).length.toLocaleString("en-IN")} />
      </StatGrid>
      <ContactsTable contacts={contacts} source={source} />
    </>
  );
}
