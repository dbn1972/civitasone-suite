"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, useToast } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import {
  DISPOSITION_LABELS,
  QC_NOTES_MAX_LENGTH,
  QC_NOTES_MIN_LENGTH,
  allowedDispositions,
  isDispositionAllowed,
  notesRequired,
  type Disposition,
  type QcVerdict,
} from "./qcMatrix";

const VERDICT_LABELS: Record<QcVerdict, string> = { passed: "PASS", failed: "FAIL" };

const DISPOSITION_VERBS: Record<Disposition, string> = {
  restock: "restock",
  quarantine: "quarantine",
  scrap: "scrap",
};

/**
 * Records the QC verdict for a pending goods return.
 *
 * - GAP-INVENTORY-GOODS-RETURNS-DETAIL-01: the disposition list is derived
 *   from the verdict (a failed item can never be restocked, a passed one never
 *   scrapped) and neither starts pre-selected unless only one choice exists.
 * - GAP-INVENTORY-GOODS-RETURNS-DETAIL-02: option labels state exactly what the
 *   backend stores (see qcMatrix.ts).
 * - GAP-INVENTORY-GOODS-RETURNS-DETAIL-04: the verdict is confirmed in a dialog
 *   before anything is sent, notes are mandatory for a failed/scrapped return,
 *   and success is announced with a toast.
 */
export function QcInspectionForm({
  goodsReturnId,
  qty,
  itemName,
}: {
  goodsReturnId: string;
  /** Used only to make the confirmation sentence concrete. */
  qty?: number;
  itemName?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [qcStatus, setQcStatus] = useState<QcVerdict | "">("");
  const [disposition, setDisposition] = useState<Disposition | "">("");
  const [remarks, setRemarks] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const formError = useFormError("QC inspection");

  const trimmedNotes = remarks.trim();
  const needsNotes = notesRequired(qcStatus, disposition);
  const notesTooShort = needsNotes && trimmedNotes.length < QC_NOTES_MIN_LENGTH;
  const options = qcStatus ? allowedDispositions(qcStatus) : [];
  const canReview = qcStatus !== "" && disposition !== "" && !notesTooShort;

  function chooseVerdict(next: QcVerdict) {
    setQcStatus(next);
    const allowed = allowedDispositions(next);
    // Keep a still-valid choice; otherwise preselect only an unambiguous one.
    setDisposition((prev) => (prev !== "" && isDispositionAllowed(next, prev) ? prev : allowed.length === 1 ? allowed[0]! : ""));
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    if (!qcStatus || !disposition) {
      setMessage("Choose a verdict and a disposition before recording.");
      return;
    }
    if (notesTooShort) {
      setMessage(`Inspector notes of at least ${QC_NOTES_MIN_LENGTH} characters are required for a failed or scrapped return.`);
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit() {
    if (!qcStatus || !disposition) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/inventory/goods-returns/${goodsReturnId}/inspect`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          qcStatus,
          disposition,
          qcNotes: trimmedNotes || undefined,
        }),
      });
      if (!res.ok) {
        setDialogError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setConfirmOpen(false);
      toast.success("QC verdict recorded.");
      // The page is already on this URL: refresh to flip to the read-only verdict.
      router.refresh();
    } catch (caught) {
      setDialogError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const subject = [qty !== undefined ? `${qty} unit${qty === 1 ? "" : "s"}` : null, itemName ? `of ${itemName}` : null]
    .filter(Boolean)
    .join(" ");
  const confirmSentence =
    qcStatus && disposition
      ? `Record ${VERDICT_LABELS[qcStatus]} and ${DISPOSITION_VERBS[disposition]}${subject ? ` ${subject}` : ""}?`
      : "";

  return (
    <form className="card pad" onSubmit={handleReview} style={{ maxWidth: 560 }} noValidate>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Verdict</legend>
        <div style={{ display: "flex", gap: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="radio"
              name="qcStatus"
              value="passed"
              checked={qcStatus === "passed"}
              onChange={() => chooseVerdict("passed")}
            />
            Pass
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="radio"
              name="qcStatus"
              value="failed"
              checked={qcStatus === "failed"}
              onChange={() => chooseVerdict("failed")}
            />
            Fail
          </label>
        </div>
      </fieldset>

      <div className="fields" style={{ marginTop: 16 }}>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Disposition</span>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as Disposition | "")}
            disabled={qcStatus === ""}
            aria-describedby="qc-disposition-hint"
            style={{ minHeight: 44 }}
          >
            <option value="">{qcStatus === "" ? "Choose a verdict first" : "Choose a disposition"}</option>
            {options.map((d) => (
              <option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>
            ))}
          </select>
          <span id="qc-disposition-hint" style={{ fontSize: "0.8125rem", color: "#475569" }}>
            {qcStatus === "failed"
              ? "A failed return can only be quarantined or scrapped, never returned to sellable stock."
              : qcStatus === "passed"
                ? "A passed return goes back to stock; it cannot be scrapped."
                : "The choices depend on the verdict."}
          </span>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">
            Inspector notes{needsNotes ? ` (required, at least ${QC_NOTES_MIN_LENGTH} characters)` : ""}
          </span>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            maxLength={QC_NOTES_MAX_LENGTH}
            required={needsNotes}
            aria-required={needsNotes}
            placeholder="Condition observed, reason for verdict"
            style={{ minHeight: 88 }}
          />
        </label>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role="alert" style={{ marginTop: 12, fontSize: "0.875rem", color: "#b91c1c" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={!canReview || busy}>
          Record verdict
        </button>
        <Link href="/inventory/goods-returns" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Record QC verdict?"
        description={`${confirmSentence} This is recorded against your name and cannot be changed from this screen.`}
        confirmLabel="Record verdict"
        danger={qcStatus === "failed"}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={() => void submit()}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
      />
    </form>
  );
}
