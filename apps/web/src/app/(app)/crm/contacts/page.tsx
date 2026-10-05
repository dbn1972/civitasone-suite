import { PageHeader, StatCard, StatGrid, maskEmail, maskPhone } from "../../../_components/ds";
import { MergeButton } from "../../../_components/crm/MergeButton";
import { LeadFilters } from "../../../_components/crm/LeadFilters";
import type { MergeOption } from "../../../_components/crm/MergeDialog";
import { getCrmContacts } from "../../../_data/loaders";
import { getSessionRoles, hasAnyRole, CRM_PII_READ_ROLES, CRM_CONTACTS_EXPORT_ROLES } from "@/lib/auth/roleGuard";
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

  // GAP-CRM-CONTACTS-02: DPDP — the base crm_user sees masked phone/email; only
  // privileged roles see the clear value. Computed server-side from the session.
  const sessionRoles = getSessionRoles();
  const canViewPii = hasAnyRole(sessionRoles, CRM_PII_READ_ROLES);
  // GAP-CRM-CONTACTS-01: only permitted roles may bulk-export, and the export
  // must respect the active filters rather than dumping the whole registry.
  const canExport = hasAnyRole(sessionRoles, CRM_CONTACTS_EXPORT_ROLES);
  const exportQuery: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string" && value.trim()) exportQuery[key] = value;
  }

  // DPDP: mask on the SERVER, before the rows become client props / the offline
  // seed cache. Only CRM_PII_READ_ROLES ever receive clear phone/email.
  const safeContacts = canViewPii
    ? contacts
    : contacts.map((c) => ({
        ...c,
        phone: c.phone ? maskPhone(c.phone) : c.phone,
        email: c.email ? maskEmail(c.email) : c.email,
      }));

  const mergeOptions: MergeOption[] = safeContacts
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
        subtitle="Vendor, beneficiary, NGO, and government official contacts — tenant-scoped contact master • संपर्क पंजी"
        back="/crm"
      />
      {/* UX-002: the data-source badge now lives in ContactsTable, driven by
          the same useSeededResource call that produces its rows. */}
      <div role="note" aria-label="Data protection notice" className="flex items-start gap-2.5 mt-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <span aria-hidden="true" className="text-base leading-snug">🛡</span>
        <span>Personal data in this registry is protected under the Digital Personal Data Protection Act, 2023. Access is role-scoped and logged.</span>
      </div>
      <ContactToolbar canExport={canExport} exportQuery={exportQuery} />
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
        <StatCard icon="▣" iconBg="#eef2ff" label="Total Contacts" value={stat(contacts.length)} />
        <StatCard icon="△" iconBg="#fef2f2" label="Priority Contacts" value={stat(contacts.filter(c => c.priority === "high").length)} />
        {/* Distinct from "Priority Contacts" above: any classification priority set
            (high/medium/low), not just high. These previously used the identical
            `priority === "high"` expression, so the two cards always showed the same
            number — this one now counts what its label says. */}
        <StatCard icon="◉" iconBg="#fffbeb" label="With Priority Tag" value={stat(contacts.filter(c => Boolean(c.priority)).length)} />
        <StatCard icon="◈" iconBg="#eef2ff" label="Reachable by Email" value={stat(contacts.filter(c => c.email).length)} />
      </StatGrid>
      <ContactsTable contacts={safeContacts} source={source} />
    </>
  );
}
