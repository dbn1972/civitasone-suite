"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable } from "../../../../_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

type ParsedContact = { name: string; email?: string; phone?: string; company?: string; leadStatus: string };

function parseCsv(csv: string): { rows: ParsedContact[]; invalid: number } {
  const lines = csv.trim().split("\n").slice(1).filter(Boolean);
  let invalid = 0;
  const rows: ParsedContact[] = [];
  for (const line of lines) {
    const [name, email, phone, company, leadStatus] = line.split(",").map((s) => s.trim());
    if (!name) {
      invalid += 1;
      continue;
    }
    rows.push({
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(company ? { company } : {}),
      leadStatus: leadStatus || "new",
    });
  }
  return { rows, invalid };
}

export default function ImportContactsPage() {
  const [csv, setCsv] = useState("name,email,phone,company,leadStatus\nSample User,user@example.com,9900000000,Acme Corp,new");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const { rows: preview, invalid } = useMemo(() => parseCsv(csv), [csv]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const contacts = preview.map((c) => ({
        name: c.name,
        email: c.email || undefined,
        phone: c.phone || undefined,
        company: c.company || undefined,
        leadStatus: c.leadStatus as "new",
      }));
      if (contacts.length === 0) throw new Error("No valid rows to import.");
      const res = await browserFetch("v1/crm/contacts/bulk/import", {
        method: "POST",
        body: JSON.stringify({ contacts }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setMessage(`Import accepted — ${contacts.length} contacts queued.`);
      setTimeout(() => router.push("/crm/contacts"), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import the contacts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/crm/contacts">← Contacts</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>Import Contacts</h1>
        <div className="sub">Bulk load — CSV columns: name, email, phone, company, leadStatus</div>
      </div>
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{error}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <label htmlFor="import-csv" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
            CSV data
          </label>
          <textarea id="import-csv" value={csv} onChange={(e) => setCsv(e.target.value)} rows={12} style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 12, borderRadius: 8, border: "1px solid var(--line)" }} />
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0" }}>
            {preview.length} valid row{preview.length === 1 ? "" : "s"} ready{invalid > 0 ? ` · ${invalid} row${invalid === 1 ? "" : "s"} skipped (missing name)` : ""}.
          </p>
          <button type="submit" className="btn primary" disabled={busy || preview.length === 0} style={{ marginTop: 12, minHeight: 44 }}>
            {busy ? "Importing…" : `Import ${preview.length} contact${preview.length === 1 ? "" : "s"}`}
          </button>
        </form>
      </div>
      {preview.length > 0 ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-h"><h3>Preview</h3></div>
          <DataTable
            columns={[
              { key: "name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "phone", label: "Phone" },
              { key: "company", label: "Organisation" },
              { key: "leadStatus", label: "Lead Status" },
            ]}
            rows={preview.slice(0, 50).map((c, i) => ({
              id: String(i),
              name: c.name,
              email: c.email ?? "—",
              phone: c.phone ?? "—",
              company: c.company ?? "—",
              leadStatus: c.leadStatus,
            }))}
          />
        </div>
      ) : null}
    </>
  );
}
