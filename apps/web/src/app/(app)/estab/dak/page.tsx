"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Button, PageHeader, StatusPill, DataTable, EmptyState, ErrorState,
  ConfirmDialog, // GAP-ESTAB-DAK-01: confirmation before opening file
} from "../../../_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";

// GAP-ESTAB-DAK-01: classification is no longer hard-coded; the clerk chooses.
const CLASSIFICATIONS = ["public", "confidential", "secret", "top_secret"] as const;
const CLASS_LABEL: Record<string, string> = {
  public: "Public",
  confidential: "Confidential",
  secret: "Secret",
  top_secret: "Top Secret",
};

// GAP-ESTAB-DAK-03: register form matches registerInwardBody on the server.
const MODES = ["post", "email", "fax", "hand", "portal", "courier"] as const;

type InwardRow = {
  id: string;
  dakNo: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  status: string;
  fileId?: string | null;
  fileRef?: string | null;
  barcode?: string | null;
  sourceSection?: string | null;
};

type OpenFileForm = {
  inwardId: string;
  dakNo: string;
  subject: string;
  dept: string;
  classification: string;
};

export default function DakRegistryPage() {
  const router = useRouter();
  const formError = useFormError("DAK register");
  const [rows, setRows] = useState<InwardRow[]>([]);
  const [loading, setLoading] = useState(true);
  // GAP-ESTAB-DAK-03: extended form matching the server's registerInwardBody.
  const [form, setForm] = useState({
    dakNo: "", fromAddress: "", subject: "",
    mode: "" as string, receivedDate: "", urgency: "" as string,
  });
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [loadError, setLoadError] = useState(false);
  // GAP-ESTAB-DAK-01: open-file dialog state
  const [openFileDialog, setOpenFileDialog] = useState<OpenFileForm | null>(null);
  const [openFileBusy, setOpenFileBusy] = useState(false);
  const [openFileError, setOpenFileError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/proxy/v1/estab/inward?limit=100", { signal });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      const body = await res.json() as { data?: InwardRow[] };
      setRows(body.data ?? []);
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // GAP-ESTAB-DAK-02: clerk-safe error on registerDak + capture dakNo in success.
  async function registerDak(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setActionError("");
    try {
      const payload: Record<string, string> = {
        fromAddress: form.fromAddress,
        subject: form.subject,
      };
      if (form.dakNo) payload.dakNo = form.dakNo;
      // GAP-ESTAB-DAK-03: pass the optional mode/receivedDate/urgency fields.
      if (form.mode) payload.mode = form.mode;
      if (form.receivedDate) payload.receivedDate = form.receivedDate;
      if (form.urgency) payload.urgency = form.urgency;

      const res = await fetch("/api/proxy/v1/estab/inward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      // GAP-ESTAB-DAK-05: include the number in the success message.
      const savedNo = form.dakNo || "(auto-assigned)";
      setForm({ dakNo: "", fromAddress: "", subject: "", mode: "", receivedDate: "", urgency: "" });
      setMessage(`DAK ${savedNo} registered.`);
      await load();
    } catch (e) {
      setActionError(formError.fromException("save", e).message);
    }
  }

  // GAP-ESTAB-DAK-01: open-file dialog initiation.
  function promptOpenFile(row: InwardRow) {
    setOpenFileDialog({
      inwardId: row.id,
      dakNo: row.dakNo,
      subject: row.subject,
      dept: "",
      classification: "", // force a choice — never default to "public"
    });
    setOpenFileError("");
  }

  // GAP-ESTAB-DAK-01 + DAK-02: confirmed open-file with chosen classification.
  async function confirmOpenFile() {
    if (!openFileDialog) return;
    if (!openFileDialog.dept.trim()) { setOpenFileError("Department is required."); return; }
    if (!openFileDialog.classification) { setOpenFileError("Select a classification."); return; }
    setOpenFileBusy(true);
    setOpenFileError("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/inward/${openFileDialog.inwardId}/open-file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dept: openFileDialog.dept.trim(),
          classification: openFileDialog.classification,
        }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      const body = await res.json() as { id?: string };
      setOpenFileDialog(null);
      if (body.id) router.push(`/estab/files/${body.id}`);
      else {
        setMessage("File opening — refresh in a moment.");
        await load();
      }
    } catch (e) {
      setOpenFileError(formError.fromException("save", e).message);
    } finally {
      setOpenFileBusy(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: 8, borderRadius: 8,
    border: "1px solid var(--line)", minHeight: 44,
  } as const;

  return (
    <>
      <PageHeader
        title="DAK / Inward Registry"
        subtitle="Register incoming dak, link to digital files — NIC eOffice integrated flow."
        back="/estab"
      />

      {/* GAP-ESTAB-DAK-06: DS tokens instead of hex literals */}
      <div role="status" aria-live="polite">
        {message ? (
          <div className="alert good" style={{ borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 13 }}>
            {message}
            <button type="button" style={{ marginInlineStart: 12, border: "none", background: "transparent", cursor: "pointer", fontSize: 12 }} onClick={() => setMessage("")}>Dismiss</button>
          </div>
        ) : null}
      </div>
      <div role="alert" aria-live="assertive">
        {actionError ? (
          <div className="alert bad" style={{ borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 13 }}>
            {actionError}
            <button type="button" style={{ marginInlineStart: 12, border: "none", background: "transparent", cursor: "pointer", fontSize: 12 }} onClick={() => setActionError("")}>Dismiss</button>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h"><h3>Register new DAK</h3></div>
        <form onSubmit={registerDak} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-no">DAK number <span style={{ color: "var(--mut)", fontWeight: 400 }}>(auto if blank)</span></label>
              <input id="dak-no" value={form.dakNo} onChange={(e) => setForm({ ...form, dakNo: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-from">From</label>
              <input id="dak-from" required value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-subject">Subject</label>
              <input id="dak-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} style={inputStyle} />
            </div>
            {/* GAP-ESTAB-DAK-03: additional fields matching registerInwardBody */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-mode">Mode</label>
              <select id="dak-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} style={inputStyle}>
                <option value="">— not specified —</option>
                {MODES.map((m) => <option key={m} value={m}>{humanizeStatus(m)}</option>)}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-received">Received date</label>
              <input id="dak-received" type="date" value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="dak-urgency">Urgency</label>
              <select id="dak-urgency" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} style={inputStyle}>
                <option value="">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="immediate">Immediate</option>
              </select>
            </div>
          </div>
          <Button type="submit" style={{ marginTop: 12 }}>Register DAK</Button>
        </form>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Inward register</h3>
          {/* GAP-ESTAB-DAK-04: truncation notice */}
          {!loading && !loadError && rows.length === 100 && (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Showing latest 100 entries</span>
          )}
        </div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
        ) : loadError ? (
          <div className="pad"><ErrorState error={toHumanError("load", { area: "inward register" })} onRetry={() => void load()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📥" title="No DAK registered yet" message="Register incoming dak above to start tracking it here." />
        ) : (
          <DataTable<InwardRow>
            columns={[
              { key: "dakNo", label: "DAK No", render: (r) => <span className="mono">{r.dakNo}</span> },
              { key: "barcode", label: "Barcode", render: (r) => <span className="mono" style={{ fontSize: 11 }}>{r.barcode ?? "—"}</span> },
              {
                key: "sourceSection", label: "Source",
                // GAP-ESTAB-DAK-05: "—" for null, not the invented literal "manual".
                render: (r) => <>{r.sourceSection ? humanizeStatus(r.sourceSection) : "—"}</>,
              },
              { key: "fromAddress", label: "From" },
              { key: "subject", label: "Subject" },
              { key: "receivedAt", label: "Received", render: (r) => <>{formatIndianDate(r.receivedAt)}</> },
              {
                key: "status", label: "Status",
                // GAP-ESTAB-DAK-05: drop the label prop so StatusPill humanises internally.
                render: (r) => <StatusPill status={r.status} />,
              },
              {
                key: "fileId",
                label: "File",
                render: (r) =>
                  r.fileId ? (
                    <Link href={`/estab/files/${r.fileId}`} className="mono">{r.fileRef ?? r.fileId.slice(0, 8)}</Link>
                  ) : (
                    <>—</>
                  ),
              },
              {
                key: "id",
                label: "Action",
                sortable: false,
                // GAP-ESTAB-DAK-01: opens a dialog instead of direct POST.
                render: (r) =>
                  !r.fileId && r.status === "received" ? (
                    <Button type="button" variant="ghost" onClick={() => promptOpenFile(r)}>
                      Open file
                    </Button>
                  ) : (
                    <>—</>
                  ),
              },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Scan / search barcode or DAK no"
            pageSize={15}
          />
        )}
      </div>

      {/* GAP-ESTAB-DAK-01: open-file confirmation dialog with classification + dept. */}
      {openFileDialog && (
        <ConfirmDialog
          open
          title={`Open file from DAK ${openFileDialog.dakNo}`}
          description={`Subject: ${openFileDialog.subject}. Choose the department and security classification for the new digital file.`}
          confirmLabel={openFileBusy ? "Opening…" : "Open the file"}
          onConfirm={confirmOpenFile}
          onCancel={() => setOpenFileDialog(null)}
        >
          <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Department <span style={{ color: "var(--bad)" }}>*</span></span>
              <input
                value={openFileDialog.dept}
                onChange={(e) => setOpenFileDialog({ ...openFileDialog, dept: e.target.value })}
                placeholder="e.g. ADMIN, GA, Finance"
                required
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Classification <span style={{ color: "var(--bad)" }}>*</span></span>
              <select
                value={openFileDialog.classification}
                onChange={(e) => setOpenFileDialog({ ...openFileDialog, classification: e.target.value })}
                required
              >
                <option value="">— select —</option>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>{CLASS_LABEL[c]}</option>
                ))}
              </select>
            </label>
            {openFileError && <p role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{openFileError}</p>}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
