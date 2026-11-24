"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AcceptedNotice, ActionButton, Button, EntityPicker, Field, Input, Textarea } from "@/app/_components/ds";
import { UserFacingError } from "@/lib/userFacingError";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";
import { formatShortId, todayIST } from "@/lib/formatters";
import { searchInspectionProvisions, resolveInspectionProvisions } from "@/lib/entityAdapters/inspectionAssign";
import { CreateCapaButton } from "../../capa/CapaActions";
import { FINDING_CLOSED_STATE, FINDING_OPEN_STATE } from "../../intakeMeta";

export type FindingRow = {
  id: string;
  findingNumber?: string | null;
  severity?: string | null;
  state?: string | null;
  description?: string | null;
};

/**
 * Observation -> finding -> notice / verify -> CAPA on one inspection (inspection-service findings + capa routes):
 *   POST /findings                       { inspectionId, provisionId, description }
 *   POST /findings/:id/compliance-notice { dueDate YYYY-MM-DD, requiredAction, responsibleParty }
 *   POST /findings/:id/verify            { verifierNotes? }
 *   POST /capa                           (CreateCapaButton)
 * Every write is a 202; the page shows the shared AcceptedNotice and a manual refresh, never a fake success.
 * The role flags only decide what is offered; the service re-checks every call.
 */
export function FindingsPanel({
  inspectionId,
  findings,
  canWrite,
  canNotice,
  canCapa,
}: {
  inspectionId: string;
  findings: FindingRow[];
  canWrite: boolean;
  canNotice: boolean;
  canCapa: boolean;
}) {
  const t = useTranslations("inspectionIntake");
  const router = useRouter();
  const formError = useFormError("finding");
  const accepted = useAcceptedWrite();
  const [provisionId, setProvisionId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // compliance-notice dialog fields (one dialog open at a time)
  const [dueDate, setDueDate] = useState("");
  const [requiredAction, setRequiredAction] = useState("");
  const [responsibleParty, setResponsibleParty] = useState("");

  async function post(path: string, body?: Record<string, unknown>) {
    const res = await fetch(`/api/proxy/v1/inspection/findings${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 202 && !res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
  }

  async function createFinding(e: React.FormEvent) {
    e.preventDefault();
    if (!provisionId || !description.trim()) {
      setError(t("findingRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await post("", { inspectionId, provisionId, description: description.trim() });
      accepted.accept();
      setProvisionId(null);
      setDescription("");
      router.refresh();
    } catch (err) {
      setError(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  const noticeIncomplete = !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || requiredAction.trim() === "" || responsibleParty.trim() === "";
  const lbl = { display: "block", fontSize: 13, margin: "8px 0 2px" } as const;

  return (
    <section aria-label={t("findingsTitle")} style={{ marginTop: 16 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{t("findingsTitle")}</h2>
      {findings.length === 0 ? (
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--ink2)" }}>{t("findingsEmpty")}</p>
      ) : (
        <table className="tbl" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th scope="col">{t("colFinding")}</th>
              <th scope="col">{t("colSeverity")}</th>
              <th scope="col">{t("colState")}</th>
              <th scope="col">{t("colDescription")}</th>
              <th scope="col">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => {
              const state = f.state ?? "";
              return (
                <tr key={f.id}>
                  <td>{f.findingNumber || formatShortId(f.id)}</td>
                  <td>{f.severity ?? "—"}</td>
                  <td>{state.replace(/_/g, " ") || "—"}</td>
                  <td>{f.description ?? "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {canNotice && state === FINDING_OPEN_STATE ? (
                        <ActionButton
                          label={t("noticeLabel")}
                          className="btn ghost"
                          confirmTitle={t("noticeTitle")}
                          confirmDescription={t("noticeDescription")}
                          confirmLabel={t("noticeSubmit")}
                          blockConfirm={noticeIncomplete}
                          onConfirm={() => post(`/${f.id}/compliance-notice`, { dueDate, requiredAction: requiredAction.trim(), responsibleParty: responsibleParty.trim() })}
                          onSuccess={() => {
                            setDueDate("");
                            setRequiredAction("");
                            setResponsibleParty("");
                            accepted.accept();
                            router.refresh();
                          }}
                        >
                          <label style={lbl} htmlFor={`notice-due-${f.id}`}>{t("noticeDueLabel")}</label>
                          <Input id={`notice-due-${f.id}`} type="date" min={todayIST()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                          <label style={lbl} htmlFor={`notice-action-${f.id}`}>{t("noticeActionLabel")}</label>
                          <Textarea id={`notice-action-${f.id}`} rows={3} value={requiredAction} onChange={(e) => setRequiredAction(e.target.value)} />
                          <label style={lbl} htmlFor={`notice-party-${f.id}`}>{t("noticePartyLabel")}</label>
                          <Input id={`notice-party-${f.id}`} value={responsibleParty} onChange={(e) => setResponsibleParty(e.target.value)} />
                        </ActionButton>
                      ) : null}
                      {canWrite && state !== FINDING_CLOSED_STATE ? (
                        <ActionButton
                          label={t("verifyLabel")}
                          className="btn ghost"
                          confirmTitle={t("verifyTitle")}
                          confirmDescription={t("verifyDescription")}
                          confirmLabel={t("verifySubmit")}
                          optionalReason
                          reasonLabel={t("verifyNotesLabel")}
                          maxReasonLength={2000}
                          onConfirm={(notes) => post(`/${f.id}/verify`, notes && notes.trim() ? { verifierNotes: notes.trim() } : {})}
                          onSuccess={() => {
                            accepted.accept();
                            router.refresh();
                          }}
                        />
                      ) : null}
                      {canCapa ? <CreateCapaButton findingId={f.id} /> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {canWrite ? (
        <form className="card pad" onSubmit={(e) => void createFinding(e)} noValidate aria-label={t("findingNewTitle")}>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{t("findingNewTitle")}</h3>
          <div className="fields">
            <Field id="finding-provision" label={t("provisionLabel")} required>
              <EntityPicker
                value={provisionId}
                onChange={(v) => setProvisionId(Array.isArray(v) ? (v[0] ?? null) : v)}
                search={searchInspectionProvisions}
                resolve={resolveInspectionProvisions}
                disabled={busy}
                aria-label={t("provisionLabel")}
                placeholder={t("provisionPlaceholder")}
              />
            </Field>
            <Field id="finding-description" label={t("findingDescriptionLabel")} required style={{ gridColumn: "1 / -1" }}>
              <Textarea rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <div role="status" aria-live="polite">
            {error ? <p role="alert" style={{ margin: "8px 0 0", fontSize: 14, color: "var(--bad)" }}>{error}</p> : null}
          </div>
          <div style={{ marginTop: 12 }}>
            <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy}>{t("findingSubmit")}</Button>
          </div>
        </form>
      ) : null}
      <AcceptedNotice {...accepted.noticeProps} />
    </section>
  );
}
