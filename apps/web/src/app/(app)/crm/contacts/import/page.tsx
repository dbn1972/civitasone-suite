"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, DataTable, PageHeader } from "../../../../_components/ds";
import {
  browserFetch,
  errorMessageFromResponse,
} from "@/lib/api/browserClient";
import { parseContactCsv, IMPORT_COLUMNS } from "@/lib/crm/contactImport";
import { duplicateCheck, type DuplicateCandidate } from "@/lib/crm/dataQuality";

const HEADER_LINE = IMPORT_COLUMNS.join(",");
const TEMPLATE =
  `${HEADER_LINE}\n` +
  "Asha Rao,asha@example.com,9900000000,Acme Corp,new,false";

export default function ImportContactsPage() {
  const t = useTranslations("crmContactsImport");
  const [csv, setCsv] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("contact import");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Potential duplicates found by the pre-import check, and whether the user
  // has acknowledged them ("import anyway").
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const [ackDuplicates, setAckDuplicates] = useState(false);
  const router = useRouter();

  const { rows: preview, rejected } = useMemo(() => parseContactCsv(csv), [csv]);

  function downloadTemplate() {
    const blob = new Blob([`${TEMPLATE}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function setCsvText(next: string) {
    setCsv(next);
    // Any edit invalidates a prior duplicate acknowledgement / result.
    setAckDuplicates(false);
    setDuplicates([]);
  }

  /** DQ-001: check each row that has an email/phone for an existing match. */
  async function runDuplicateCheck(): Promise<DuplicateCandidate[]> {
    const checkable = preview.filter((c) => c.email || c.phone);
    if (checkable.length === 0) return []; // ux-001-ok: `preview` is rows parsed from the user's own pasted/uploaded CSV in local state, not a loader result
    setChecking(true);
    try {
      const results = await Promise.all(
        checkable.map((c) =>
          duplicateCheck({
            name: c.name,
            ...(c.email ? { email: c.email } : {}),
            ...(c.phone ? { phone: c.phone } : {}),
            ...(c.company ? { company: c.company } : {}),
          }).catch(() => [] as DuplicateCandidate[]),
        ),
      );
      // De-duplicate the flattened candidate list by id.
      const seen = new Map<string, DuplicateCandidate>();
      for (const found of results) for (const cand of found) seen.set(cand.id, cand);
      const unique = [...seen.values()].sort((a, b) => b.score - a.score);
      setDuplicates(unique);
      return unique;
    } finally {
      setChecking(false);
    }
  }

  async function beginImport(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (preview.length === 0) { // ux-001-ok: `preview` is locally parsed CSV rows, not a fetched list; there is no source/error state to mask
      setError(t("noValidRows"));
      return;
    }
    if (!ackDuplicates) {
      const found = await runDuplicateCheck();
      if (found.length > 0) return; // surface the warning; wait for acknowledgement
    }
    setConfirmOpen(true);
  }

  async function doImport() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const contacts = preview.map((c) => ({
        name: c.name,
        ...(c.email ? { email: c.email } : {}),
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.company ? { company: c.company } : {}),
        leadStatus: c.leadStatus,
        marketingConsent: c.marketingConsent,
      }));
      const res = await browserFetch("v1/crm/contacts/bulk/import", {
        method: "POST",
        body: JSON.stringify({ contacts }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setConfirmOpen(false);
      setMessage(`Import accepted — ${contacts.length} contacts queued.`);
      setTimeout(() => router.push("/crm/contacts"), 800);
    } catch (e) {
      setError(
        formError.fromException("save", e).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Import Contacts"
        subtitle={t("subtitle")}
        back="/crm/contacts"
        backLabel="Contacts"
      />
      {message ? (
        <div
          role="status"
          aria-live="polite"
          className="banner"
          style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}
        >
          {message}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="banner"
          style={{ background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}
        >
          {error}
        </div>
      ) : null}
      <div className="card">
        <form onSubmit={beginImport} className="pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <label
              htmlFor="import-csv"
              style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}
            >
              {t("csvData")}
            </label>
            <Button type="button" variant="ghost" onClick={downloadTemplate} style={{ minHeight: 36 }}>
              {t("downloadTemplate")}
            </Button>
          </div>
          <textarea
            id="import-csv"
            value={csv}
            onChange={(e) => setCsvText(e.target.value)}
            rows={12}
            placeholder={TEMPLATE}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 12, borderRadius: 8, border: "1px solid var(--line)" }}
          />
          <p
            role="status"
            aria-live="polite"
            style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0" }}
          >
            {t("readySummary", { valid: preview.length, rejected: rejected.length })}
          </p>

          {duplicates.length > 0 ? (
            <div role="alert" style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 12, marginTop: 12, fontSize: 13 }}>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
                {t("duplicatesFound", { count: duplicates.length })}
              </p>
              <ul style={{ margin: "0 0 8px 18px" }}>
                {duplicates.slice(0, 10).map((d) => (
                  <li key={d.id}>
                    {d.matchedFields.length
                      ? t("matchedLine", { name: d.name ?? d.id, fields: d.matchedFields.join(", ") })
                      : (d.name ?? d.id)}
                  </li>
                ))}
              </ul>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={ackDuplicates} onChange={(e) => setAckDuplicates(e.target.checked)} />
                {t("importAnyway")}
              </label>
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={busy || checking || preview.length === 0 /* ux-001-ok: locally parsed CSV rows, not a loader result */ || (duplicates.length > 0 && !ackDuplicates)}
            loading={busy || checking}
            style={{ marginTop: 12, minHeight: 44 }}
          >
            {busy
              ? t("importing")
              : checking
                ? t("checking")
                : t("importButton", { count: preview.length })}
          </Button>
        </form>
      </div>

      {rejected.length > 0 ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-h">
            <h3>{t("rejectedHeading", { count: rejected.length })}</h3>
          </div>
          <DataTable
            columns={[
              { key: "line", label: t("colLine") },
              { key: "reason", label: t("colReason") },
            ]}
            rows={rejected.map((r) => ({ id: String(r.line), line: r.line, reason: r.reason }))}
          />
        </div>
      ) : null}

      {preview.length > 0 ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-h">
            <h3>Preview</h3>
          </div>
          <DataTable
            columns={[
              { key: "name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "phone", label: "Phone" },
              { key: "company", label: "Organisation" },
              { key: "leadStatus", label: "Lead Status" },
              { key: "marketingConsent", label: t("colMarketingConsent") },
            ]}
            rows={preview.slice(0, 50).map((c, i) => ({
              id: String(i),
              name: c.name,
              email: c.email ?? "—",
              phone: c.phone ?? "—",
              company: c.company ?? "—",
              leadStatus: c.leadStatus,
              marketingConsent: c.marketingConsent ? t("yes") : t("no"),
            }))}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle", { count: preview.length })}
        description={t("confirmDescription", { count: preview.length })}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={() => void doImport()}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </div>
  );
}
