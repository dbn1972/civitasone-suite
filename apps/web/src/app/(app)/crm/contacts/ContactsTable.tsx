"use client";

import Link from "next/link";
import { EmptyState } from "../../../_components/ds";
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

  return (
    <div className="card">
      <div className="card-h"><h3>Contacts</h3></div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px", paddingLeft: 12 }}>
          {cacheNote}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="👤" title="No contacts yet" message="Add your first contact to get started." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Organisation</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Lead Status</th>
              <th>Last Activity</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id ?? c.email ?? c.name} className="clickable">
                <td>
                  {c.id ? (
                    <Link href={`/crm/contacts/${c.id}`} style={{ fontWeight: 500 }}>{c.name}</Link>
                  ) : c.name}
                </td>
                <td>{c.account ?? "—"}</td>
                <td>{c.phone ?? "—"}</td>
                <td>{c.email ?? "—"}</td>
                <td>{c.leadStatus ?? "—"}</td>
                <td>{c.lastActivity ?? "—"}</td>
                <td>{c.tags?.length ? c.tags.join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
