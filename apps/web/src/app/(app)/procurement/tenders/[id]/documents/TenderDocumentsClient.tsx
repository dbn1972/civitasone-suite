"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { FileUpload, PageHeader, StatusPill, ErrorState, Button } from "../../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { TenderDocumentSummary } from "../../../../../_data/loaders";

// GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-05: human labels for the doc-type
// enum, used both in the <option> list and the table chip, so the table no
// longer prints the raw enum ("technical_spec").
const DOC_TYPE_LABELS: Record<string, string> = {
  nit: "NIT",
  rfp: "Request for Proposal",
  boq: "Bill of Quantities",
  bid_form: "Bid form",
  technical_spec: "Technical specification",
  financial_spec: "Financial specification",
  corrigendum: "Corrigendum",
  addendum: "Addendum",
  other: "Other",
};

// Backend addDocBody enum is nit/rfp/boq/corrigendum/addendum/other.
const DOC_TYPES = ["nit", "rfp", "boq", "corrigendum", "addendum", "other"] as const;

function docTypeLabel(t: string): string {
  return DOC_TYPE_LABELS[t] ?? t.replace(/_/g, " ");
}

function formatBytes(bytes: string | number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  const n = typeof bytes === "number" ? bytes : parseInt(bytes, 10);
  if (isNaN(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return Math.round(n / 1024 / 1024) + " MB";
}

export function TenderDocumentsClient({
  tenderId,
  tenderNo,
  title,
  status,
  canUpload,
}: {
  tenderId: string;
  tenderNo: string;
  title: string;
  status: string;
  canUpload: boolean;
}) {
  const [docs, setDocs] = useState<TenderDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState<string>("other");
  const [fileKey, setFileKey] = useState("");
  const [fileUploadNonce, setFileUploadNonce] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");

  // GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-01: corrigendum extra fields.
  const [revisedClosingDate, setRevisedClosingDate] = useState("");
  const [corrigendumReason, setCorrigendumReason] = useState("");

  const isPublished = status !== "draft";

  function tenderDocDownloadError(): string {
    const human = toHumanError("load", { area: "download link" });
    return `${human.what} ${human.next}`;
  }
  function tenderDocSaveError(): string {
    const human = toHumanError("save", { area: "tender document" });
    return `${human.what} ${human.next}`;
  }

  async function load(signal?: AbortSignal) {
    setLoading(true);
    // GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-04: clear a stale error on retry.
    setError("");
    try {
      const res = await fetch(
        "/api/proxy/v1/procurement/tenders/" + tenderId + "/documents",
        { signal },
      );
      // DOCUMENTS-04: a non-OK response (401/403/500) must be an error, not an
      // empty list that reads as "No documents" / "no NIT".
      if (!res.ok) {
        setError(toHumanError("load", { area: "documents" }).what);
        return;
      }
      const json = (await res.json()) as { data?: unknown };
      if (!Array.isArray(json.data)) {
        setError(toHumanError("load", { area: "documents" }).what);
        return;
      }
      setDocs(json.data as TenderDocumentSummary[]);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load closes only over tenderId
  }, [tenderId]);

  async function handleDownload(storageRef: string, docId: string) {
    setDownloadError("");
    setDownloadingId(docId);
    try {
      const res = await fetch("/api/proxy/v1/admin/uploads/" + encodeURIComponent(storageRef));
      if (!res.ok) { setDownloadError(tenderDocDownloadError()); return; }
      const { downloadUrl } = (await res.json()) as { downloadUrl?: string };
      if (!downloadUrl) { setDownloadError(tenderDocDownloadError()); return; }
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      setDownloadError(tenderDocDownloadError());
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!docTitle.trim() || !fileKey) {
      setSaveMsg("Title and an uploaded file are required.");
      return;
    }
    setSaving(true);
    setSaveMsg("");
    try {
      // GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-01: a corrigendum amends a LIVE
      // tender — it goes through the dedicated corrigendum endpoint (which can
      // carry a revised bid-closing date, emits an audit event and supports
      // republish/supersede), not the plain document add. The document itself
      // is still attached so it appears in the register.
      if (docType === "corrigendum") {
        if (corrigendumReason.trim().length < 4) {
          setSaveMsg("A corrigendum needs a reason (minimum 4 characters).");
          setSaving(false);
          return;
        }
        const corr = await fetch("/api/proxy/v1/procurement/tenders/" + tenderId + "/corrigenda", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: docTitle.trim(),
            description: corrigendumReason.trim(),
            storageRef: fileKey,
            ...(revisedClosingDate ? { newBidClosingDate: revisedClosingDate } : {}),
          }),
        });
        if (!corr.ok) { setSaveMsg(tenderDocSaveError()); setSaving(false); return; }
      }

      const res = await fetch(
        "/api/proxy/v1/procurement/tenders/" + tenderId + "/documents",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docType, title: docTitle.trim(), storageRef: fileKey }),
        },
      );
      if (!res.ok) { setSaveMsg(tenderDocSaveError()); return; }
      setSaveMsg("Document uploaded.");
      setDocTitle("");
      setFileKey("");
      setDocType("other");
      setRevisedClosingDate("");
      setCorrigendumReason("");
      setFileUploadNonce((n) => n + 1);
      void load();
    } catch {
      setSaveMsg(tenderDocSaveError());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-main wrap">
      <div style={{ maxWidth: 900 }}>
        <PageHeader
          title={tenderNo}
          subtitle={title}
          back={"/procurement/tenders/" + tenderId}
          backLabel="Tender"
          help="procurement"
          actions={
            <>
              <StatusPill status={status} />
              {error ? <DataSourceBadge source="error" message="Couldn't load documents — showing nothing" /> : null}
            </>
          }
        />

        {/* GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-02: published-tender warning. */}
        {isPublished ? (
          <div className="card pad" style={{ marginBottom: 16, borderInlineStart: "3px solid var(--warn)" }} role="note">
            <strong>Published tender.</strong> Bidders can see documents you add here. Use a corrigendum to amend a live tender.
          </div>
        ) : null}

        {/* Upload form — role-gated (DOCUMENTS-01). */}
        {canUpload ? (
          <form onSubmit={(e) => void handleSave(e)} className="card pad" style={{ marginBottom: 20 }} noValidate>
            <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Upload document</h2>
            <div className="fields">
              <div className="field">
                <label className="label" htmlFor="doc-title">Title *</label>
                <input id="doc-title" className="inp" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} style={{ minHeight: 44 }} required />
              </div>
              <div className="field">
                <label className="label" htmlFor="doc-type">Document type</label>
                <select id="doc-type" className="inp" value={docType} onChange={(e) => setDocType(e.target.value)} style={{ minHeight: 44 }}>
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>{docTypeLabel(t)}</option>
                  ))}
                </select>
              </div>
              {/* DOCUMENTS-01: corrigendum amendment fields. */}
              {docType === "corrigendum" ? (
                <>
                  <div className="field">
                    <label className="label" htmlFor="corr-date">Revised bid closing date</label>
                    <input id="corr-date" type="date" className="inp" value={revisedClosingDate} onChange={(e) => setRevisedClosingDate(e.target.value)} style={{ minHeight: 44 }} />
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label className="label" htmlFor="corr-reason">Reason for corrigendum *</label>
                    <textarea id="corr-reason" className="inp" rows={2} value={corrigendumReason} onChange={(e) => setCorrigendumReason(e.target.value)} />
                  </div>
                </>
              ) : null}
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <FileUpload key={fileUploadNonce} category="document" label="File *" maxSizeMb={25} onUploaded={(key) => setFileKey(key)} />
              </div>
            </div>
            {saveMsg ? (
              <p role={saveMsg === "Document uploaded." ? "status" : "alert"} style={{ marginTop: 8, fontSize: 13, color: saveMsg === "Document uploaded." ? "var(--good)" : "var(--bad)" }}>
                {saveMsg}
              </p>
            ) : null}
            <div style={{ marginTop: 16 }}>
              <Button type="submit" variant="primary" disabled={saving || !fileKey} style={{ minHeight: 44 }}>
                {saving ? "Saving…" : "Save document"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="card pad" style={{ marginBottom: 20 }} role="note">
            You do not have permission to upload tender documents. Contact a procurement officer.
          </div>
        )}

        {/* Document list */}
        <div className="card">
          {downloadError ? (
            <p role="alert" style={{ margin: 0, padding: "10px 16px 0", fontSize: 13, color: "var(--bad)" }}>{downloadError}</p>
          ) : null}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Type</th>
                  <th scope="col">Size</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", padding: "24px", color: "var(--ink2)" }}>Loading…</td></tr>
                ) : error ? (
                  <tr>
                    <td colSpan={5} style={{ padding: "24px 12px" }}>
                      <ErrorState error={toHumanError("load", { area: "documents" })} onRetry={() => void load()} />
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", padding: "24px", color: "var(--ink2)" }}>No documents uploaded yet.</td></tr>
                ) : (
                  docs.map((doc) => (
                    <tr key={doc.id}>
                      <td>{doc.title}</td>
                      <td>
                        <span style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 3, padding: "1px 6px", fontSize: 11 }}>
                          {docTypeLabel(doc.docType)}
                        </span>
                      </td>
                      <td>{formatBytes(doc.sizeBytes)}</td>
                      {/* DOCUMENTS-03/05: tolerate either uploadedAt or createdAt; format via the shared IST helper. */}
                      <td style={{ fontSize: 12, color: "var(--ink2)" }}>
                        {formatIndianDate(doc.uploadedAt ?? (doc as { createdAt?: string }).createdAt ?? null)}
                      </td>
                      <td>
                        <Button
                          type="button"
                          onClick={() => void handleDownload(doc.storageRef, doc.id)}
                          disabled={downloadingId === doc.id}
                          variant="primary"
                          style={{ fontSize: 12, padding: "2px 10px" }}
                        >
                          {downloadingId === doc.id ? "Preparing…" : "Download"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        {!canUpload ? null : (
          <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 8 }}>
            <Link href={"/procurement/tenders/" + tenderId}>Back to tender</Link>
          </p>
        )}
      </div>
    </div>
  );
}
