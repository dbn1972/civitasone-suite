"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ContactToolbar() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<"all" | "mine" | "recent">("all");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function applyFilters() {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (segment !== "all") params.set("segment", segment);
    router.push(`/crm/contacts?${params.toString()}`);
  }

  async function exportContacts() {
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/crm/contacts/export");
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { data: unknown[] };
      const blob = new Blob([JSON.stringify(body.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`Exported ${body.data.length} contacts.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export contacts.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, company…"
          aria-label="Search contacts by name, email or company"
          style={{ flex: 1, minWidth: 200, padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" }}
          onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
        />
        <select value={segment} onChange={(e) => setSegment(e.target.value as typeof segment)} aria-label="Filter contacts by segment" style={{ padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" }}>
          <option value="all">All</option>
          <option value="mine">Mine</option>
          <option value="recent">Recent</option>
        </select>
        <button type="button" className="btn ghost" onClick={applyFilters} style={{ minHeight: 44 }}>Search</button>
        <a className="btn primary" href="/crm/contacts/new" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>+ New Contact</a>
        <button type="button" className="btn ghost" onClick={() => void exportContacts()} style={{ minHeight: 44 }}>Export</button>
        <a className="btn ghost" href="/crm/contacts/import" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Import</a>
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
    </div>
  );
}
