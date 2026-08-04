"use client";

import { DataTable, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Contact = {
  id?: string | null;
  name: string;
  account?: string | null;
  phone?: string | null;
  email?: string | null;
  leadStatus?: string | null;
  lastActivity?: string | null;
  tags?: string[] | null;
  temperature?: string | null;
  priority?: string | null;
  segment?: string | null;
  expectedValueDisplay?: string | null;
};

type ContactRow = {
  id?: string;
  name: string;
  account: string;
  phone: string;
  email: string;
  leadStatus: string;
  temperature: string;
  priority: string;
  segment: string;
  expectedValue: string;
  lastActivity: string;
  tags: string;
};

export function ContactsTable({ contacts, source = "api" }: { contacts: Contact[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Contact[]>(
    "crm.contacts",
    contacts,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const tableRows: ContactRow[] = rows.map((c) => ({
    ...(c.id ? { id: c.id } : {}),
    name: c.name,
    account: c.account ?? "—",
    phone: c.phone ?? "—",
    email: c.email ?? "—",
    leadStatus: c.leadStatus ?? "—",
    temperature: c.temperature ?? "—",
    priority: c.priority ?? "—",
    segment: c.segment ?? "—",
    expectedValue: c.expectedValueDisplay ?? "—",
    lastActivity: c.lastActivity ? formatIndianDate(c.lastActivity) : "—",
    tags: c.tags?.length ? c.tags.join(", ") : "—",
  }));

  return (
    <div className="card">
      <div className="card-h"><h3>Contacts</h3></div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px", paddingLeft: 12 }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="👤" title="No contacts yet" message="Add your first contact to get started." />
      ) : (
        <DataTable<ContactRow>
          columns={[
            { key: "name", label: "Name" },
            { key: "account", label: "Organisation" },
            { key: "phone", label: "Phone" },
            { key: "leadStatus", label: "Lead Status" },
            { key: "temperature", label: "Temperature" },
            { key: "priority", label: "Priority" },
            { key: "segment", label: "Segment" },
            { key: "expectedValue", label: "Expected Value", align: "right" },
            { key: "email", label: "Email" },
            { key: "lastActivity", label: "Last Activity" },
            { key: "tags", label: "Tags" },
          ]}
          rows={tableRows}
          rowHref={(row) => (row.id ? `/crm/contacts/${row.id}` : "")}
          sortable
          filterable
          filterPlaceholder="Filter contacts…"
          pageSize={25}
        />
      )}
    </div>
  );
}
