"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useConfirmAction, ConfirmDialog } from "../../../../_components/ds";

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
  const [error, setError] = useState("");

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
      setMessage("");
      setError("Write a yellow note before saving.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/notings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // SECURITY: no officerId — the server derives the noting's officer
        // of record from the authenticated actor; a client-supplied id would
        // be ignored (and must never be a placeholder in the first place).
        body: JSON.stringify({
          body: noteBody.trim(),
          noteType: "yellow",
          action: "draft",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNoteBody("");
      setMessage("Yellow note saved.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  }

  async function submitForApproval(remarks?: string) {
    if (!draftNotingId) {
      throw new Error("No draft yellow note to submit.");
    }
    setMessage("");
    setError("");
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

  // Signing is irreversible — it writes a green, hash-chained note in the
  // officer's name — so it is gated behind a ConfirmDialog (see signConfirm).
  async function signNoteAction() {
    if (!draftNotingId) throw new Error("No draft note to sign.");
    setMessage("");
    setError("");
    const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/notings/${draftNotingId}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(await res.text());
    setMessage("Note signed — recorded as a green note in the file's hash-chained noting trail.");
    router.refresh();
  }

  const signConfirm = useConfirmAction({ onConfirm: () => signNoteAction() });

  // Referring a file changes its custody — gated behind a ConfirmDialog that
  // names the destination officer.
  async function referBackAction() {
    // SECURITY: no placeholder fallback — referring a file must always name a
    // real destination officer. onReferBackClick() already blocks this action
    // unless referTargetValid is true, so toOfficer is guaranteed non-empty here.
    const target = toOfficer.trim();
    setMessage("");
    setError("");
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
  }

  const referConfirm = useConfirmAction({ onConfirm: () => referBackAction() });

  // SECURITY: no placeholder fallback here either — an empty toOfficer must
  // fail validation (below) and block the action, not silently resolve to a
  // phantom officer that happens to look like a valid UUID.
  const referTarget = toOfficer.trim();
  const referTargetValid = /^[0-9a-f-]{36}$/i.test(referTarget);
  const referTargetOperator = operators.find((o) => o.employeeId === referTarget);
  const referTargetLabel = referTargetOperator
    ? operatorLabel(referTargetOperator)
    : `officer ${referTarget.slice(0, 8)}…`;

  // Validate before opening the confirm dialog so we never confirm an invalid id.
  function onReferBackClick() {
    if (!referTargetValid) {
      setMessage("");
      setError("Pick an officer or enter a valid officer ID before referring back.");
      return;
    }
    referConfirm.trigger();
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
          <button type="button" className="btn ghost" disabled={busy || signConfirm.busy || !draftNotingId} onClick={signConfirm.trigger}
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
          <button type="button" className="btn ghost" disabled={busy || referConfirm.busy} onClick={onReferBackClick}>
            Refer back
          </button>
        </div>
        {error ? (
          <div role="alert" aria-live="assertive">
            <p style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>{error}</p>
          </div>
        ) : null}
        <div role="status" aria-live="polite">
          {message ? <p style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>{message}</p> : null}
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
      <ConfirmDialog
        open={signConfirm.open}
        title="Sign this note as a green note?"
        description="This records your e-signature into the file's tamper-evident (hash-chained) noting trail as a green note in your name. A signed note cannot be edited or withdrawn."
        confirmLabel="Sign note"
        danger
        busy={signConfirm.busy}
        errorMessage={signConfirm.error}
        onConfirm={signConfirm.confirm}
        onCancel={signConfirm.cancel}
      />
      <ConfirmDialog
        open={referConfirm.open}
        title="Refer this file to another officer?"
        description={`This moves the file off your desk to ${referTargetLabel}. They take custody and it leaves your pending list.`}
        confirmLabel="Refer file"
        danger
        busy={referConfirm.busy}
        errorMessage={referConfirm.error}
        onConfirm={referConfirm.confirm}
        onCancel={referConfirm.cancel}
      />
    </div>
  );
}
