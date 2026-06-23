"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ImportContactsPage() {
  const [csv, setCsv] = useState("name,email,phone,company,leadStatus\nSample User,user@example.com,9900000000,Acme Corp,new");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const lines = csv.trim().split("\n").slice(1);
      const contacts = lines.filter(Boolean).map((line) => {
        const [name, email, phone, company, leadStatus] = line.split(",").map((s) => s.trim());
        return { name, email: email || undefined, phone: phone || undefined, company: company || undefined, leadStatus: (leadStatus as "new") || "new" };
      });
      const res = await fetch("/api/proxy/v1/crm/contacts/bulk/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contacts }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(`Import accepted — ${contacts.length} contacts queued.`);
      setTimeout(() => router.push("/crm/contacts"), 800);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/crm/contacts">← Contacts</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>Import Contacts</h1>
        <div className="sub">Bulk load — CSV: name,email,phone,company,leadStatus</div>
      </div>
      <div className="card">
        <form onSubmit={submit} className="pad">
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={12} style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 12, borderRadius: 8, border: "1px solid var(--line)" }} />
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Importing…" : "Import"}</button>
          {message ? <p style={{ marginTop: 12, fontSize: 13, color: "#047857" }}>{message}</p> : null}
        </form>
      </div>
    </>
  );
}
