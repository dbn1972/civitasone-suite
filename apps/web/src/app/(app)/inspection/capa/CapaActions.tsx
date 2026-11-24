"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { AcceptedNotice, ActionButton, EntityPicker, Input, Select, Textarea } from "@/app/_components/ds";
import { searchDirectoryUsers, resolveDirectoryUsers } from "@/lib/directory/searchUsers";
import { todayIST } from "@/lib/formatters";
import { CAPA_TYPES } from "../intakeMeta";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";

type RowProps = { id: string; status: string; reInspectionTriggered?: boolean };

export function CapaRowAction({ id, status, reInspectionTriggered = false }: RowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const formError = useFormError("capa");

  // SF-15: a 202 means "received", not "done". Remember the status at the time of
  // the 202 and show the shared AcceptedNotice (with a manual Refresh) instead of a
  // timer that guesses the write has landed (GAP-INSPECTION-CAPA-04 /
  // GAP-INSPECTION-INSPECTIONS-02 asked for an honest "still processing" state).
  const accepted = useAcceptedWrite();
  const [priorStatus, setPriorStatus] = useState<string | null>(null);

  // The server data caught up (status changed): drop the notice.
  useEffect(() => {
    if (priorStatus === null || status === priorStatus) return;
    setMessage("");
    setPriorStatus(null);
    accepted.reset();
  }, [status, priorStatus, accepted]);

  function markAccepted(prior: string): void {
    setPriorStatus(prior);
    accepted.accept();
  }

  const canStart = status === "open";
  const canComplete = status === "in_progress" || status === "overdue";
  const canVerify = status === "completed";

  // A verified CAPA can trigger the follow-up re-inspection (POST /capa/:id/trigger-reinspection), once.
  const canReinspect = status === "verified" && !reInspectionTriggered;

  if (!canStart && !canComplete && !canVerify && !canReinspect) {
    return <span style={{ color: "var(--ink2)", fontSize: 12 }}>&#8212;</span>;
  }

  async function start() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    setPriorStatus(null);
    accepted.reset();
    try {
      const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/start`, { method: "POST" });
      if (res.status !== 202 && !res.ok) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      setMessage("Start requested — the status will update shortly.");
      router.refresh();
      markAccepted(status);
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  async function completeWithRemarks(reason?: string) {
    const note = (reason ?? "").trim();
    if (!note) throw new Error("Closure remarks are required.");
    const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidenceOfClosure: [{ source: "user", note }] }),
    });
    if (res.status !== 202 && !res.ok) {
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
    }
  }

  async function verify() {
    const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effectivenessVerified: true }),
    });
    if (res.status !== 202 && !res.ok) {
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canStart ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void start()}>
            Start
          </button>
        ) : null}
        {canComplete ? (
          <ActionButton
            label="Complete"
            className="btn ghost"
            confirmTitle="Complete this corrective action?"
            confirmDescription="Record what was done to close this CAPA. These remarks are saved as the closure evidence and cannot be left blank."
            confirmLabel="Mark complete"
            requireReason
            reasonLabel="Closure remarks"
            onConfirm={completeWithRemarks}
            onSuccess={() => {
              setMessage("Completion requested — the status will update shortly.");
              router.refresh();
              markAccepted(status);
            }}
          />
        ) : null}
        {canVerify ? (
          <ActionButton
            label="Verify"
            className="btn ghost"
            confirmTitle="Verify effectiveness?"
            confirmDescription="Confirm you have checked that this corrective action was effective. This is a sign-off step."
            confirmLabel="Confirm verification"
            onConfirm={() => verify()}
            onSuccess={() => {
              setMessage("Verification requested — the status will update shortly.");
              router.refresh();
              markAccepted(status);
            }}
          />
        ) : null}
        {canReinspect ? (
          <ReinspectionButton
            id={id}
            onDone={() => {
              router.refresh();
              markAccepted(status);
            }}
          />
        ) : null}
      </div>
      {accepted.phase !== "idle" ? (
        <AcceptedNotice {...accepted.noticeProps} message={message} />
      ) : message ? (
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--good)" }}>
          {message}
        </span>
      ) : null}
      {error ? (
        <span role="alert" style={{ fontSize: 11, color: "var(--bad)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Trigger the follow-up re-inspection for a verified CAPA. Body-less POST; the service returns 202. */
function ReinspectionButton({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useTranslations("inspectionIntake");
  const formError = useFormError("capa");
  return (
    <ActionButton
      label={t("reinspectLabel")}
      className="btn ghost"
      confirmTitle={t("reinspectConfirmTitle")}
      confirmDescription={t("reinspectConfirmDescription")}
      confirmLabel={t("reinspectLabel")}
      onConfirm={async () => {
        const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/trigger-reinspection`, { method: "POST" });
        if (res.status !== 202 && !res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }}
      onSuccess={onDone}
    />
  );
}

/**
 * Raise a CAPA against a finding: POST /v1/inspection/capa
 * body { findingId, type: corrective|preventive, description, ownerId?, dueDate?: YYYY-MM-DD }
 * (capa/routes.ts createCapaSchema).
 */
export function CreateCapaButton({ findingId }: { findingId: string }) {
  const t = useTranslations("inspectionIntake");
  const router = useRouter();
  const formError = useFormError("capa");
  const [type, setType] = useState<string>("corrective");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function create() {
    const body = {
      findingId,
      type,
      description: description.trim(),
      ...(ownerId ? { ownerId } : {}),
      ...(dueDate ? { dueDate } : {}),
    };
    const res = await fetch("/api/proxy/v1/inspection/capa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 202 && !res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
  }

  const lbl = { display: "block", fontSize: 13, margin: "8px 0 2px" } as const;
  return (
    <>
      <ActionButton
        label={t("capaRaiseLabel")}
        className="btn ghost"
        confirmTitle={t("capaRaiseTitle")}
        confirmDescription={t("capaRaiseDescription")}
        confirmLabel={t("capaRaiseSubmit")}
        blockConfirm={description.trim() === ""}
        onConfirm={create}
        onSuccess={() => {
          setDescription("");
          setDueDate("");
          setOwnerId(null);
          setMessage(t("capaRaised"));
          router.refresh();
        }}
      >
        <label style={lbl} htmlFor={`capa-type-${findingId}`}>{t("capaTypeLabel")}</label>
        <Select id={`capa-type-${findingId}`} value={type} onChange={(e) => setType(e.target.value)}>
          {CAPA_TYPES.map((c) => (
            <option key={c} value={c}>{t(c === "corrective" ? "capaTypeCorrective" : "capaTypePreventive")}</option>
          ))}
        </Select>
        <label style={lbl} htmlFor={`capa-desc-${findingId}`}>{t("capaDescriptionLabel")}</label>
        <Textarea id={`capa-desc-${findingId}`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <label style={lbl} htmlFor={`capa-due-${findingId}`}>{t("capaDueLabel")}</label>
        <Input id={`capa-due-${findingId}`} type="date" min={todayIST()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <label style={lbl}>{t("capaOwnerLabel")}</label>
        <EntityPicker
          value={ownerId}
          onChange={(v) => setOwnerId(Array.isArray(v) ? (v[0] ?? null) : v)}
          search={searchDirectoryUsers}
          resolve={resolveDirectoryUsers}
          placeholder={t("capaOwnerPlaceholder")}
        />
      </ActionButton>
      {message ? (
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--good)" }}>{message}</span>
      ) : null}
    </>
  );
}
