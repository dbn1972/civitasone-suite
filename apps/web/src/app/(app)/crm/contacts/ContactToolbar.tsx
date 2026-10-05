"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useFormError } from "@/lib/useFormError";
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
  /** GAP-CRM-CONTACTS-04: seed the search box from the URL so it isn't blank after a search. */
  initialSearch?: string;
  /** GAP-CRM-CONTACTS-04: seed the segment view-mode from the URL. */
  initialSegment?: "all" | "mine" | "recent";
};

export function ContactToolbar({ canExport = false, exportQuery = {}, initialSearch = "", initialSegment = "all" }: Props) {
  const t = useTranslations("crmContactToolbar");
  const tExport = useTranslations("crmExport");
  const router = useRouter();
  const searchParams = useSearchParams();
  // GAP-CRM-CONTACTS-04: seed from the URL so after a search the box isn't blank
  // and a reload keeps the control populated.
  const [search, setSearch] = useState(initialSearch);
  const [segment, setSegment] = useState<"all" | "mine" | "recent">(initialSegment);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("contact export");
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function applyFilters() {
    // GAP-CRM-CONTACTS-04: start from the CURRENT URL so the classification
    // filters (temperature/priority/segmentName/…) set by LeadFilters are
    // preserved; only this control's own keys (search, segment) are updated.
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (search.trim()) params.set("search", search.trim());
    else params.delete("search");
    if (segment !== "all") params.set("segment", segment);
    else params.delete("segment");
    const qs = params.toString();
    router.push(qs ? `/crm/contacts?${qs}` : "/crm/contacts");
  }

  function clearAll() {
    // GAP-CRM-CONTACTS-04: a single control to drop every filter (search,
    // segment and the classification params) and return to the full list.
    setSearch("");
    setSegment("all");
    router.push("/crm/contacts");
  }

  async function exportContacts(purpose?: string) {
    setMessage("");
    setError("");
    setBusy(true);
    try {
      // Forward the active filters AND the mandatory purpose so the backend
      // audit event records why this PII egress happened (CLAUDE.md rule 8).
      // F2-01: the server now returns CSV directly (text/csv), applies the
      // filters, masks PII by role and audits the export — so the client just
      // streams the response to a file instead of re-serialising JSON.
      const params = new URLSearchParams(exportQuery);
      if (purpose) params.set("purpose", purpose);
      const qs = params.toString();
      const res = await browserFetch(`v1/crm/contacts/export${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      const csv = await res.text();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setMessage(tExport("contactsDone"));
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
        {/* GAP-CRM-CONTACTS-07: this is the view-mode selector (All/Mine/Recent),
            distinct from the classification "segment" in LeadFilters. Labelled
            "View" so the two filter mechanisms don't both read as "segment".
            The backend/URL key stays `segment` (see applyFilters) so bookmarked
            ?segment= URLs keep working. */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>View</span>
          <select value={segment} onChange={(e) => setSegment(e.target.value as typeof segment)} aria-label="Filter contacts by view" style={{ padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" }}>
            <option value="all">All</option>
            <option value="mine">Mine</option>
            <option value="recent">Recent</option>
          </select>
        </label>
        <Button variant="ghost" onClick={applyFilters} style={{ minHeight: 44 }}>Search</Button>
        {/* GAP-CRM-CONTACTS-04: one-click reset of search + segment + classification filters. */}
        {(search.trim() || segment !== "all" || Object.keys(exportQuery).length > 0) ? (
          <Button variant="ghost" onClick={clearAll} style={{ minHeight: 44 }}>{t("clearFilters")}</Button>
        ) : null}
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
        minReasonLength={10}
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reason) => void exportContacts(reason)}
        onCancel={() => { if (!busy) setExportOpen(false); }}
      />
    </div>
  );
}
