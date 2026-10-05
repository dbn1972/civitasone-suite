"use client";

import { DataTable, EmptyState } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useTranslations } from "next-intl";
import { formatIndianDate } from "@/lib/formatters";
import { LEAD_STATUS_LABELS } from "@/lib/crm/leadQualification";
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

export function ContactsTable({ contacts, source = "api", filtered = false }: { contacts: Contact[]; source?: "api" | "error"; filtered?: boolean }) {
  const t = useTranslations("crmContactsTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Contact[]>(
    "crm.contacts",
    contacts,
    source,
    (d) => d.length === 0,
  );

  const tableRows: ContactRow[] = rows.map((c) => ({
    ...(c.id ? { id: c.id } : {}),
    name: c.name,
    account: c.account ?? "—",
    // GAP-CRM-CONTACTS-02: DPDP — phone/email arrive ALREADY masked by the server
    // page for non-privileged roles (page.tsx), so the clear value is never in
    // props, the offline seed cache or the DOM for them. Shown as received.
    phone: c.phone || "—",
    email: c.email || "—",
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
      {/* UX-002: single source of truth — reads the same useSeededResource
          call as `rows`, so it can never contradict this table. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        // GAP-CRM-CONTACTS-05: distinguish three empty-ish states instead of
        // always claiming the master is empty.
        source === "error" ? (
          // A failed load is not "no contacts" — offer a real retry, not an
          // Add-your-first-contact nudge that would mislead the user.
          <RefreshErrorState
            error={{
              what: t("loadErrorWhat"),
              next: t("loadErrorNext"),
              actions: ["retry", "help"],
            }}
            backHref="/crm/contacts"
          />
        ) : filtered ? (
          // The server filtered by search/filters and matched nothing — tell
          // the user that, with a way back to the unfiltered list.
          <EmptyState
            icon="🔍"
            title={t("noMatchTitle")}
            message={t("noMatchMessage")}
            action={<a className="btn ghost" href="/crm/contacts" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>{t("clearFilters")}</a>}
          />
        ) : (
          // Genuinely empty master — nudge the first create.
          <EmptyState
            icon="▣"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
            action={<a className="btn primary" href="/crm/contacts/new" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>{t("newContact")}</a>}
          />
        )
      ) : (
        <DataTable<ContactRow>
          columns={[
            { key: "name", label: "Name" },
            { key: "account", label: "Organisation" },
            { key: "phone", label: "Phone" },
            // GAP-CRM-CONTACTS-06: render the lead status as a toned pill with
            // the SHARED canonical label so the list, New and Edit forms all
            // name a status identically (no more raw "qualified").
            { key: "leadStatus", label: "Lead Status", cellType: "status", statusLabels: LEAD_STATUS_LABELS },
            // GAP-CRM-CONTACTS-03: this column renders c.temperature
            // (hot/warm/cold), so it must be headed "Temperature" — not
            // "Priority Level", which read as a duplicate of the "Priority"
            // (high/medium/low) column beside it.
            { key: "temperature", label: t("colTemperature") },
            { key: "priority", label: "Priority" },
            // GAP-CRM-CONTACTS-08: on phones (<640px) the 11-column table is
            // unreadable, so the secondary columns are hidden there (still in
            // the DOM + CSV); name/phone/status/priority stay visible.
            { key: "segment", label: "Segment", hideOnMobile: true },
            { key: "expectedValue", label: "Expected Value", align: "right", hideOnMobile: true },
            { key: "email", label: "Email" },
            { key: "lastActivity", label: "Last Activity", hideOnMobile: true },
            { key: "tags", label: "Tags", hideOnMobile: true },
          ]}
          rows={tableRows}
          // GAP-CRM-CONTACTS-08: return undefined (not "") for an id-less row so
          // the type is honest; DataTable renders it as a non-clickable row.
          rowHref={(row) => (row.id ? `/crm/contacts/${row.id}` : undefined)}
          sortable
          filterable
          filterPlaceholder="Filter contacts…"
          pageSize={25}
        />
      )}
    </div>
  );
}
