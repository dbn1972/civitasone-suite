"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useConfirmAction, ConfirmDialog } from "../../../../_components/ds";

const DEFAULT_OFFICER = "00000000-0000-0000-0000-000000000099";

const ROLE_LABEL: Record<string, string> = {
  dealing_hand: "Dealing Hand",
  section_officer: "Section Officer",
  under_secretary: "Under Secretary",
  deputy_secretary: "Deputy Secretary",
  director: "Director",
  hod: "Head of Department",
};

type Operator = {
  id: string;
  employeeId: string;
  division: string;
  section: string | null;
  deskRole: string;
  canInitiate: boolean;
  active: boolean;
};

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

  // Operator picker — the valid "mark/forward to" candidates (X10).
  const [operators, setOperators] = useState<Operator[]>([]);
  const [toOfficer, setToOfficer] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=false&limit=500");
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Operator[] } | Operator[];
        const list = (Array.isArray(body) ? body : (body.data ?? [])).filter((o) => o.active);
        if (!active) return;
        setOperators(list);
        if (list.length > 0 && list[0]) setToOfficer(list[0].employeeId);
      } catch {
        /* picker is optional; manual UUID entry still works */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const operatorLabel = (o: Operator) =>
    `${o.employeeId.slice(0, 8)} ·· ${o.division} ·· ${ROLE_LABEL[o.deskRole] ?? o.deskRole}`;

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

  async function signNote() {
    if (!draftNotingId) {
      setMessage("No draft note to sign.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/notings/${draftNotingId}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Note signed — recorded as a green note in the file's hash-chained noting trail.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sign failed");
    } finally {
      setBusy(false);
    }
  }

  async function referBack() {
    const target = toOfficer.trim() || DEFAULT_OFFICER;
    if (!/^[0-9a-f-]{36}$/i.test(target)) {
      setMessage("Pick an officer or enter a valid officer ID before referring back.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toOfficer: target,
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
          <button type="button" className="btn ghost" disabled={busy || !draftNotingId} onClick={() => void signNote()}
            title="Sign this note at your level — adds a green, hash-chained note (SO → US → DS)">
            Sign note (green)
          </button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label htmlFor="estab-refer-officer" className="l" style={{ fontSize: 12 }}>Refer / forward to</label>
          {operators.length > 0 ? (
            <select
              id="estab-refer-officer"
              value={toOfficer}
              onChange={(e) => setToOfficer(e.target.value)}
              style={{ width: "100%", padding: 8, marginBottom: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
            >
              {operators.map((o) => (
                <option key={o.id} value={o.employeeId}>{operatorLabel(o)}</option>
              ))}
            </select>
          ) : (
            <input
              id="estab-refer-officer"
              value={toOfficer}
              onChange={(e) => setToOfficer(e.target.value)}
              placeholder="Officer UUID (no operators enrolled yet)"
              style={{ width: "100%", padding: 8, marginBottom: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
            />
          )}
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
