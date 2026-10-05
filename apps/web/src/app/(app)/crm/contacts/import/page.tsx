"use client";

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

// GAP-CRM-CONTACTS-IMPORT-05: hard caps so a huge paste/file is neither posted
// in one unreviewable request nor allowed to exhaust the browser/backend.
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_ROWS = 5000;
const CHUNK_SIZE = 500; // rows per POST; the backend bulk endpoint caps at 500.

/** Build a CSV of rejected rows (line + reason) for client-side download. */
function rejectedToCsv(rejected: Array<{ line: number; reason: string }>): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ["line,reason", ...rejected.map((r) => `${r.line},${esc(r.reason)}`)].join("\n");
}

/**
 * GAP-CRM-CONTACTS-IMPORT-04: build a CSV of the SERVER-rejected rows (batch #,
 * row # within the batch, reason). No PII — mirrors exactly what the server
 * returns (index + coarse reason).
 */
function serverRejectedToCsv(rows: Array<{ batch: number; row: number; reason: string }>): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ["batch,row,reason", ...rows.map((r) => `${r.batch},${r.row},${esc(r.reason)}`)].join("\n");
}

/** Poll a batch's server-side result once, returning null until it exists (202/404). */
async function fetchBatchResult(batchId: string): Promise<BatchResult | null> {
  try {
    const res = await browserFetch(`v1/crm/contacts/import/${batchId}`);
    if (!res.ok) return null; // 404 while the consumer is still processing
    const body = (await res.json()) as Partial<BatchResult> | null;
    // Only accept a well-formed result; a stub/empty body means "not ready".
    if (!body || typeof body.accepted !== "number" || typeof body.rejected !== "number") return null;
    return {
      batchId,
      status: typeof body.status === "string" ? body.status : "completed",
      total: typeof body.total === "number" ? body.total : 0,
      accepted: body.accepted,
      rejected: body.rejected,
      errored: typeof body.errored === "number" ? body.errored : 0,
      rejectedRows: Array.isArray(body.rejectedRows) ? body.rejectedRows : [],
    };
  } catch {
    return null;
  }
}

type ImportSummary = {
  accepted: number;
  rejected: number;
  batches: number;
  // GAP-CRM-CONTACTS-IMPORT-04: server-reported outcomes, polled per batch from
  // GET /v1/crm/contacts/import/:batchId. `serverRejectedRows` carries only the
  // row number (within its batch) + a coarse machine reason — no PII.
  serverAccepted?: number;
  serverRejected?: number;
  serverRejectedRows?: Array<{ batch: number; row: number; reason: string }>;
  pending?: boolean;
};

/** GAP-CRM-CONTACTS-IMPORT-04: a batch result as returned by the status endpoint. */
type BatchResult = {
  batchId: string;
  status: string;
  total: number;
  accepted: number;
  rejected: number;
  errored: number;
  rejectedRows: Array<{ index: number; reason: string }>;
};

export default function ImportContactsPage() {
  const t = useTranslations("crmContactsImport");
  const [csv, setCsv] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("contact import");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // GAP-CRM-CONTACTS-IMPORT-04: the post-import summary (accepted/rejected),
  // shown in place of the old auto-redirect so a partial outcome is visible.
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  // Potential duplicates found by the pre-import check, and whether the user
  // has acknowledged them ("import anyway").
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const [ackDuplicates, setAckDuplicates] = useState(false);

  const { rows: preview, rejected } = useMemo(() => parseContactCsv(csv), [csv]);
  const overRowCap = preview.length > MAX_ROWS;
  // Parsed-CSV state (not a fetch result): there is no load/error branch to gate on.
  const hasRows = preview.length > 0;

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
    setSummary(null);
  }

  /**
   * GAP-CRM-CONTACTS-IMPORT-05: read a chosen .csv file into the textarea state
   * via FileReader, enforcing a 2 MB cap so a huge file can't be loaded whole.
   */
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > MAX_FILE_BYTES) {
      setError(t("fileTooLarge", { size: (file.size / (1024 * 1024)).toFixed(1) }));
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCsvText(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setError(t("fileReadError"));
    reader.readAsText(file);
  }

  /** GAP-CRM-CONTACTS-IMPORT-04: let the user download the rejected rows as CSV. */
  function downloadRejected() {
    const blob = new Blob([`${rejectedToCsv(rejected)}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts-import-rejected.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * GAP-CRM-CONTACTS-IMPORT-04: download the SERVER-rejected rows (duplicates /
   * errors the backend skipped) as CSV. Separate from the client-side parse
   * rejects above — these are rows that were well-formed but not inserted.
   */
  function downloadServerRejected(rows: Array<{ batch: number; row: number; reason: string }>) {
    const blob = new Blob([`${serverRejectedToCsv(rows)}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts-import-server-rejected.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * GAP-CRM-CONTACTS-IMPORT-04: poll each batch's status endpoint for the true
   * per-row outcome and fold it into the summary. Bounded retries so a slow
   * consumer shows "still processing" rather than hanging.
   */
  async function collectServerResults(batchIds: string[]) {
    if (!(batchIds.length > 0)) return; // ux-001-ok: local array, not a fetch result
    const MAX_TRIES = 6;
    const DELAY_MS = 500;
    const pending = new Map<string, BatchResult | null>(batchIds.map((id) => [id, null]));
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      await Promise.all(
        [...pending.entries()]
          .filter(([, v]) => v === null)
          .map(async ([id]) => {
            const r = await fetchBatchResult(id);
            if (r) pending.set(id, r);
          }),
      );
      const results = [...pending.values()].filter((v): v is BatchResult => v !== null);
      const stillPending = results.length < batchIds.length;
      // Fold whatever we have so far into the summary.
      let serverAccepted = 0;
      let serverRejected = 0;
      const serverRejectedRows: Array<{ batch: number; row: number; reason: string }> = [];
      results.forEach((r, batchIdx) => {
        serverAccepted += r.accepted;
        serverRejected += r.rejected;
        for (const rr of r.rejectedRows) {
          serverRejectedRows.push({ batch: batchIdx + 1, row: rr.index + 1, reason: rr.reason });
        }
      });
      setSummary((prev) =>
        prev
          ? { ...prev, serverAccepted, serverRejected, serverRejectedRows, pending: stillPending }
          : prev,
      );
      if (!stillPending) return;
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
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
    if (!hasRows) {
      setError(t("noValidRows"));
      return;
    }
    // GAP-CRM-CONTACTS-IMPORT-05: refuse an oversized import rather than posting
    // thousands of rows in one unreviewable request.
    if (overRowCap) {
      setError(t("tooManyRowsError", { count: String(preview.length), max: String(MAX_ROWS) }));
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
    setSummary(null);
    try {
      const contacts = preview.map((c) => ({
        name: c.name,
        ...(c.email ? { email: c.email } : {}),
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.company ? { company: c.company } : {}),
        leadStatus: c.leadStatus,
        marketingConsent: c.marketingConsent,
      }));
      // GAP-CRM-CONTACTS-IMPORT-05: chunk into batches of CHUNK_SIZE (the
      // backend bulk endpoint caps a request at 500) and aggregate the result.
      let acceptedTotal = 0;
      let batches = 0;
      const batchIds: string[] = [];
      for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
        const batch = contacts.slice(i, i + CHUNK_SIZE);
        const res = await browserFetch("v1/crm/contacts/bulk/import", {
          method: "POST",
          body: JSON.stringify({ contacts: batch }),
        });
        if (!res.ok) {
          // Report what already landed so a mid-way failure isn't silent.
          if (acceptedTotal > 0) {
            setSummary({ accepted: acceptedTotal, rejected: rejected.length, batches });
          }
          throw new Error(await errorMessageFromResponse(res));
        }
        // GAP-CRM-CONTACTS-IMPORT-04: capture the batchId so we can poll the
        // server for the TRUE per-row outcome (accepted / duplicate / errored),
        // not just assume every queued row landed.
        const accepted = (await res.json().catch(() => null)) as { id?: string } | null;
        if (accepted?.id) batchIds.push(accepted.id);
        acceptedTotal += batch.length;
        batches += 1;
      }
      // GAP-CRM-CONTACTS-IMPORT-04: stay on the page and show a summary instead
      // of auto-redirecting after 800 ms with no visible outcome.
      setConfirmOpen(false);
      setSummary({ accepted: acceptedTotal, rejected: rejected.length, batches });
      setMessage(t("importAccepted", { accepted: acceptedTotal, acceptedText: acceptedTotal.toLocaleString("en-IN"), batches, batchesText: batches.toLocaleString("en-IN") }));
      // Poll each batch's server result (short, bounded) and fold it into the
      // summary once available. The queue is usually drained within a few
      // hundred ms; we retry a handful of times before showing "still
      // processing" so a slow consumer never blocks the page.
      void collectServerResults(batchIds);
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
      {/* GAP-CRM-CONTACTS-IMPORT-04: an import summary shown IN PLACE of the old
          auto-redirect, so accepted/rejected counts are visible and announced. */}
      {summary ? (
        <div
          role="status"
          aria-live="polite"
          className="card"
          style={{ marginBottom: 16 }}
        >
          <div className="card-h"><h3>{t("summaryHeading")}</h3></div>
          <div className="pad" style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <p style={{ margin: 0 }}>
              {t.rich("summaryQueued", {
                n: summary.accepted,
                countText: String(summary.accepted),
                across: summary.batches > 1 ? t("acrossBatches", { count: summary.batches }) : "",
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            {summary.rejected > 0 ? (
              <p style={{ margin: 0, color: "#b42318" }}>
                {t.rich("summaryRejected", {
                  n: summary.rejected,
                  countText: String(summary.rejected),
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
            ) : null}
            {/* GAP-CRM-CONTACTS-IMPORT-04: the TRUE server-side outcome, polled
                from the job-status endpoint — how many rows the backend actually
                created vs skipped (duplicates/errors). */}
            {summary.pending ? (
              <p style={{ margin: 0, color: "var(--muted)" }} aria-live="polite">
                {t("serverProcessing")}
              </p>
            ) : summary.serverAccepted !== undefined ? (
              <>
                <p style={{ margin: 0 }}>
                  {t.rich("serverResult", {
                    created: String(summary.serverAccepted),
                    skipped: String(summary.serverRejected ?? 0),
                    hasSkipped: summary.serverRejected ? "yes" : "no",
                    strong: (chunks) => <strong>{chunks}</strong>,
                    warn: (chunks) => <strong style={{ color: "#b42318" }}>{chunks}</strong>,
                  })}
                </p>
                {summary.serverRejectedRows && summary.serverRejectedRows.length > 0 ? (
                  <Button type="button" variant="ghost" onClick={() => downloadServerRejected(summary.serverRejectedRows!)} style={{ minHeight: 40, justifySelf: "start" }}>
                    {t("downloadRejectedRows")}
                  </Button>
                ) : null}
              </>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a className="btn primary" href="/crm/contacts" style={{ minHeight: 40, display: "inline-flex", alignItems: "center" }}>{t("viewContacts")}</a>
              {summary.rejected > 0 ? (
                <Button type="button" variant="ghost" onClick={downloadRejected} style={{ minHeight: 40 }}>
                  {t("downloadPreImportRejects")}
                </Button>
              ) : null}
            </div>
          </div>
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
          {/* GAP-CRM-CONTACTS-IMPORT-05: choose a .csv file (read client-side,
              2 MB cap) as an alternative to pasting. */}
          <div style={{ marginBottom: 8 }}>
            <label htmlFor="import-file" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
              {t("chooseFile")}
            </label>
            <input id="import-file" type="file" accept=".csv,text/csv" onChange={handleFile} />
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
          {overRowCap ? (
            <p role="alert" style={{ fontSize: 13, color: "#b42318", margin: "6px 0 0" }}>
              {t("tooManyRowsAlert", { count: String(preview.length), max: String(MAX_ROWS) })}
            </p>
          ) : null}
          {rejected.length > 0 ? (
            <Button type="button" variant="ghost" onClick={downloadRejected} style={{ marginTop: 8, minHeight: 36 }}>
              {t("downloadRejectedRows")}
            </Button>
          ) : null}

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
            disabled={busy || checking || !hasRows || overRowCap || (duplicates.length > 0 && !ackDuplicates)}
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
            <h3>{t("previewHeading")}{preview.length > 50 ? t("previewShowing", { count: String(preview.length) }) : ""}</h3>
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
