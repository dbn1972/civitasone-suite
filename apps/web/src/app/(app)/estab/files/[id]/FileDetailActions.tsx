"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirmAction, ConfirmDialog } from "../../../../_components/ds";

const DEFAULT_OFFICER = "00000000-0000-0000-0000-000000000099";

type Props = {
  fileId: string;
  draftNotingId?: string;
  status: string;
};

export function FileDetailActions({ fileId, draftNotingId, status }: Props) {
  const router = useRouter();
  const [noteBody, setNoteBody] = useState("");
  const [referRemarks, setReferRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function addYellowNote() {
    if (!noteBody.trim()) {
      setMessage("Write a yellow note before saving.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/notings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: noteBody.trim(),
          officerId: DEFAULT_OFFICER,
          noteType: "yellow",
          action: "draft",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNoteBody("");
      setMessage("Yellow note saved.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  }

  async function submitForApproval(remarks?: string) {
    if (!draftNotingId) {
      setMessage("No draft yellow note to submit.");
      throw new Error("No draft yellow note to submit.");
    }
    setMessage("");
    const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/submit-for-approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notingId: draftNotingId, remarks }),
    });
    if (!res.ok) throw new Error(await res.text());
    setMessage("Submitted — Section Officer review task created (SO → US → DS chain).");
    router.refresh();
  }

  const submitConfirm = useConfirmAction({
    onConfirm: (reason) => submitForApproval(reason),
  });

  async function referBack() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toOfficer: DEFAULT_OFFICER,
          remarks: referRemarks.trim() || "Referred back",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setReferRemarks("");
      setMessage("File referred back.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Refer back failed");
    } finally {
      setBusy(false);
    }
  }

  if (status === "closed") return null;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-h"><h3>Noting &amp; approval (eOffice)</h3></div>
      <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
          Write a <span style={{ background: "#fef9c3", padding: "2px 6px", borderRadius: 4 }}>yellow note</span> (draft).
          Submit for approval — on sign-off it becomes a <span style={{ background: "#dcfce7", padding: "2px 6px", borderRadius: 4 }}>green note</span>.
        </p>
        <label htmlFor="estab-yellow-note" className="l" style={{ fontSize: 12 }}>Yellow note (draft)</label>
        <textarea
          id="estab-yellow-note"
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          rows={4}
          placeholder="Yellow note — draft observation or proposal"
          style={{ width: "100%", padding: 10, border: "1px solid #fde047", borderRadius: 8, background: "#fefce8", fontSize: 13 }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void addYellowNote()}>
            Save yellow note
          </button>
          <button type="button" className="btn primary" disabled={busy || submitConfirm.busy || !draftNotingId} onClick={submitConfirm.trigger}>
            Submit for approval
          </button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label htmlFor="estab-refer-remarks" className="l" style={{ fontSize: 12 }}>Refer-back remarks</label>
          <input
            id="estab-refer-remarks"
            value={referRemarks}
            onChange={(e) => setReferRemarks(e.target.value)}
            placeholder="Refer-back remarks"
            style={{ width: "100%", padding: 8, marginBottom: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
          />
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void referBack()}>
            Refer back
          </button>
        </div>
        <div role="status" aria-live="polite">
          {message ? <p style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
        </div>
      </div>
      <ConfirmDialog
        open={submitConfirm.open}
        title="Submit noting for approval?"
        description="This forwards the draft yellow note up the SO → US → DS approval chain. On final sign-off it becomes a green note. This cannot be undone."
        confirmLabel="Submit for approval"
        requireReason
        reasonLabel="Submission remarks"
        busy={submitConfirm.busy}
        errorMessage={submitConfirm.error}
        onConfirm={submitConfirm.confirm}
        onCancel={submitConfirm.cancel}
      />
    </div>
  );
}
