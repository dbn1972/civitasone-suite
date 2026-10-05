"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { useTranslations } from "next-intl";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { Button, ConfirmDialog } from "@/app/_components/ds";

/**
 * The active list filters, forwarded to the export so it respects the current
 * view instead of dumping the whole registry (GAP-CRM-CONTACTS-01).
 */
export type ExportQuery = Record<string, string>;

type Props = {
  /** Whether the signed-in role may bulk-export contacts (computed server-side). */
  canExport?: boolean;
  /** The current list filters to apply to the export. */
  exportQuery?: ExportQuery;
};

/** Flatten a value to a CSV cell, quoting when it contains a comma/quote/newline. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV document from an array of record rows (header from the first row's keys). */
function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(","));
  return lines.join("\n");
}

export function ContactToolbar({ canExport = false, exportQuery = {} }: Props) {
  const t = useTranslations("crmContactToolbar");
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<"all" | "mine" | "recent">("all");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("contact export");
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function applyFilters() {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (segment !== "all") params.set("segment", segment);
    router.push(`/crm/contacts?${params.toString()}`);
  }

  async function exportContacts(purpose?: string) {
    setMessage("");
    setError("");
    setBusy(true);
    try {
      // Forward the active filters AND the mandatory purpose so the backend
      // audit event records why this PII egress happened (CLAUDE.md rule 8).
      const params = new URLSearchParams(exportQuery);
      if (purpose) params.set("purpose", purpose);
      const qs = params.toString();
      const res = await browserFetch(`v1/crm/contacts/export${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      const body = (await res.json()) as { data: Array<Record<string, unknown>> };
      const csv = toCsv(body.data);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setMessage(`Exported ${body.data.length} contacts.`);
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  // Label the export honestly: "filtered" when a filter is active, else "all".
  const hasFilter = Object.keys(exportQuery).length > 0;
  const exportLabel = hasFilter ? t("exportFiltered") : t("exportAll");

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
        <Button variant="ghost" onClick={applyFilters} style={{ minHeight: 44 }}>Search</Button>
        <a className="btn primary" href="/crm/contacts/new" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>+ New Contact</a>
        {/* GAP-CRM-CONTACTS-01: bulk PII egress — only for permitted roles, and
            always behind a confirm dialog that captures a mandatory purpose. */}
        {canExport ? (
          <Button variant="ghost" onClick={() => { setMessage(""); setError(""); setExportOpen(true); }} style={{ minHeight: 44 }}>{exportLabel}</Button>
        ) : null}
        <a className="btn ghost" href="/crm/contacts/import" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Import</a>
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}

      <ConfirmDialog
        open={exportOpen}
        title={hasFilter ? t("confirmTitleFiltered") : t("confirmTitleAll")}
        description={t("confirmDescription")}
        confirmLabel={t("confirmLabel")}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={5}
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reason) => void exportContacts(reason)}
        onCancel={() => { if (!busy) setExportOpen(false); }}
      />
    </div>
  );
}
