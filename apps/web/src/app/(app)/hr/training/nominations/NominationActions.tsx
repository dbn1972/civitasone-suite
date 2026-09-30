"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, ConfirmDialog, Field, Select, Input } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDate } from "@/lib/formatters";

type SessionOption = { id: string; title: string; sessionDate: string };

function todayInIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

async function postJson(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * GAP-HR-TRAINING-NOMINATIONS-02: this table used to be read-only although
 * the empty copy promised "nominations are approved by the department head
 * before enrolment" -- the approve/reject/complete endpoints all already
 * existed server-side (training-admin/routes.ts), just with no UI reaching
 * them. Renders only the action(s) valid for the row's current status:
 * "nominated" -> Approve/Reject; "approved"/"attended" -> Complete;
 * everything else (waitlisted/rejected/completed) has no action here.
 */
export function NominationActions({ id, trainingId, status }: { id: string; trainingId: string; status: string }) {
  const t = useTranslations("trainingNominations");
  const router = useRouter();

  if (status === "nominated") {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <ApproveAction id={id} trainingId={trainingId} onDone={() => router.refresh()} />
        <RejectAction id={id} onDone={() => router.refresh()} />
      </div>
    );
  }
  if (status === "approved" || status === "attended") {
    return <CompleteAction id={id} onDone={() => router.refresh()} />;
  }
  return <span className="text-xs text-slate-400">{t("noAction")}</span>;
}

function ApproveAction({ id, trainingId, onDone }: { id: string; trainingId: string; onDone: () => void }) {
  const t = useTranslations("trainingNominations");
  const formError = useFormError("nomination approval");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionOption[] | null>(null);
  const [sessionId, setSessionId] = useState("");
  // GAP-HR-TRAINING-NOMINATIONS-02: useFormError deliberately never echoes a
  // backend `message`/`code` into its own top-level summary (see its own
  // doc comment: "NEVER add a branch here that echoes code, message, or the
  // HTTP status back to the user") -- it's fleet-wide, catalogued-copy-only
  // by design. The maker-checker case needs a specific, real sentence
  // ("you nominated this yourself"), so it's tracked separately here rather
  // than working against that hook's intent.
  const [makerCheckerError, setMakerCheckerError] = useState(false);
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    setSessions(null);
    setSessionId("");
    setMakerCheckerError(false);
    formError.clear();
    let cancelled = false;
    fetch(`/api/proxy/v1/hrms/trainings/${trainingId}/sessions`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setSessions(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trainingId]);

  async function handleConfirm() {
    if (!sessionId) return;
    setBusy(true);
    formError.clear();
    setMakerCheckerError(false);
    const res = await postJson(`/api/proxy/v1/hrms/nominations/${id}/approve`, { sessionId });
    setBusy(false);
    if (!res.ok) {
      // GAP-HR-TRAINING-NOMINATIONS-02: 409 MAKER_CHECKER means the caller
      // is the same person who made this nomination -- training-admin's own
      // maker-checker rule (canApprove), surfaced as a plain sentence
      // rather than a raw error code.
      if (res.status === 409) {
        const body = await res.clone().json().catch(() => null);
        if (body?.code === "MAKER_CHECKER") {
          setMakerCheckerError(true);
          return;
        }
      }
      await formError.fromResponse(res, "save");
      return;
    }
    setOpen(false);
    onDone();
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{t("approve")}</Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t("approveDialogTitle")} describedById={descId}>
        <p id={descId} style={{ marginBottom: 12 }}>{t("approveDialogDescription")}</p>
        {sessions === null ? (
          <p role="status">{t("loadingSessions")}</p>
        ) : sessions.length === 0 ? (
          <p role="status">{t("noSessionsAvailable")}</p>
        ) : (
          <Field label={t("sessionLabel")} required>
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} disabled={busy}>
              <option value="">{t("selectSession")}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} — {formatIndianDate(s.sessionDate)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {makerCheckerError && <p role="alert" style={{ color: "#b91c1c", marginTop: 8 }}>{t("makerCheckerError")}</p>}
        {formError.message && <p role="alert" style={{ color: "#b91c1c", marginTop: 8 }}>{formError.message}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("cancel")}</Button>
          <Button variant="primary" onClick={() => void handleConfirm()} disabled={busy || !sessionId} aria-busy={busy}>
            {busy ? t("approving") : t("confirmApprove")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function RejectAction({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useTranslations("trainingNominations");
  const formError = useFormError("nomination rejection");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    formError.clear();
    const res = await postJson(`/api/proxy/v1/hrms/nominations/${id}/reject`);
    setBusy(false);
    if (!res.ok) {
      await formError.fromResponse(res, "save");
      return;
    }
    setOpen(false);
    onDone();
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>{t("reject")}</Button>
      <ConfirmDialog
        open={open}
        title={t("rejectDialogTitle")}
        description={t("rejectDialogDescription")}
        danger
        busy={busy}
        errorMessage={formError.message}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function CompleteAction({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useTranslations("trainingNominations");
  const formError = useFormError("nomination completion");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completedDate, setCompletedDate] = useState(todayInIst());
  const [result, setResult] = useState<"pass" | "fail">("pass");
  const [score, setScore] = useState("");

  async function handleConfirm() {
    setBusy(true);
    formError.clear();
    const trimmedScore = score.trim();
    const res = await postJson(`/api/proxy/v1/hrms/nominations/${id}/complete`, {
      completedDate,
      result,
      ...(trimmedScore ? { score: Number(trimmedScore) } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      await formError.fromResponse(res, "save");
      return;
    }
    setOpen(false);
    onDone();
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{t("complete")}</Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t("completeDialogTitle")}>
        <div style={{ display: "grid", gap: 12 }}>
          <Field label={t("completedDateLabel")} required>
            <Input type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} disabled={busy} />
          </Field>
          <Field label={t("resultLabel")} required>
            <Select value={result} onChange={(e) => setResult(e.target.value as "pass" | "fail")} disabled={busy}>
              <option value="pass">{t("resultPass")}</option>
              <option value="fail">{t("resultFail")}</option>
            </Select>
          </Field>
          <Field label={t("scoreLabel")}>
            <Input type="number" min={0} max={100} step={1} value={score} onChange={(e) => setScore(e.target.value)} disabled={busy} />
          </Field>
        </div>
        {formError.message && <p role="alert" style={{ color: "#b91c1c", marginTop: 8 }}>{formError.message}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("cancel")}</Button>
          <Button variant="primary" onClick={() => void handleConfirm()} disabled={busy || !completedDate} aria-busy={busy}>
            {busy ? t("completing") : t("confirmComplete")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
