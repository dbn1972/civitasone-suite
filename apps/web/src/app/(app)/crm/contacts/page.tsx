import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { MergeButton } from "../../../_components/crm/MergeButton";
import { LeadFilters } from "../../../_components/crm/LeadFilters";
import type { MergeOption } from "../../../_components/crm/MergeDialog";
import { getCrmContacts } from "../../../_data/loaders";
import { ContactToolbar } from "./ContactToolbar";
import { ContactsTable } from "./ContactsTable";

type SP = {
  search?: string;
  /** Toolbar view-mode (mine/recent) — distinct from the classification segment. */
  segment?: string;
  /** LQ-003 classification segment filter. */
  segmentName?: string;
  temperature?: string;
  priority?: string;
  product?: string;
  region?: string;
  status?: string;
  source?: string;
};

export default async function Page({ searchParams }: { searchParams?: SP }) {
  const { data: contacts, source } = await getCrmContacts({
    search: searchParams?.search,
    segment: searchParams?.segment,
    segmentName: searchParams?.segmentName,
    temperature: searchParams?.temperature,
    priority: searchParams?.priority,
    product: searchParams?.product,
    region: searchParams?.region,
    status: searchParams?.status,
    source: searchParams?.source,
  });

  // Never fabricate a 0 count when the list load failed — show "—" instead.
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  const mergeOptions: MergeOption[] = contacts
    .filter((c): c is typeof c & { id: string } => Boolean(c.id))
    .map((c) => ({
      id: c.id,
      label: c.email ? `${c.name} · ${c.email}` : c.name,
      fields: {
        Name: c.name,
        Email: c.email,
        Phone: c.phone,
        Organisation: c.account,
      },
    }));

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Vendor, beneficiary, NGO, and government official contacts — tenant-scoped contact master."
        back="/crm"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <ContactToolbar />
      <LeadFilters
        initial={{
          temperature: searchParams?.temperature,
          priority: searchParams?.priority,
          segmentName: searchParams?.segmentName,
          product: searchParams?.product,
          region: searchParams?.region,
          status: searchParams?.status,
          source: searchParams?.source,
        }}
      />
      {mergeOptions.length >= 2 ? <MergeButton entity="contacts" options={mergeOptions} label="Merge duplicate contacts" /> : null}
      <StatGrid>
        <StatCard icon="👤" iconBg="#eef2ff" label="Total Contacts" value={stat(contacts.length)} />
        <StatCard icon="🔥" iconBg="#fef2f2" label="High Priority Leads" value={stat(contacts.filter(c => c.temperature === "hot").length)} />
        <StatCard icon="⭐" iconBg="#fffbeb" label="High Priority" value={stat(contacts.filter(c => c.priority === "high").length)} />
        <StatCard icon="✉️" iconBg="#eef2ff" label="With Email" value={stat(contacts.filter(c => c.email).length)} />
      </StatGrid>
      <ContactsTable contacts={contacts} source={source} />
    </>
  );
}
