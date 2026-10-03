"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Select } from "@/app/_components/ds";
import type { TenantApprovalPolicy, TenantLifecycleRequest } from "@/app/_data/loaders";
import { useFormError } from "@/lib/useFormError";
import {
  actsDirectly, availableActions, checkEditForm, describeChanges, failureKey, hasAnyAction, hasRequests,
  kindKey, knownErrorCode, listSignature, requestStatusKey, requestTone, tenantStatusKey, toIsoOrNull,
  type EditForm,
} from "./lifecycleModel";
import { cancelUrl, decisionUrl, errorCodeOf, pollRequests, requestsUrl, sendJson } from "./lifecycleApi";

type Dialog =
  | { type: "suspend" }
  | { type: "reactivate" }
  | { type: "edit" }
  | { type: "approve"; request: TenantLifecycleRequest }
  | { type: "reject"; request: TenantLifecycleRequest }
  | { type: "cancel"; request: TenantLifecycleRequest }
  | null;

export type TenantLifecycleSectionProps = {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  current: EditForm;
  initialRequests: TenantLifecycleRequest[];
  requestsSource: "api" | "error";
  policy: TenantApprovalPolicy;
};

const EDITIONS = ["govt_dept", "psu", "small_office"] as const;

export function TenantLifecycleSection({
  tenantId, tenantName, tenantStatus, current, initialRequests, requestsSource, policy,
}: TenantLifecycleSectionProps) {
  const t = useTranslations("tenantLifecycle");
  const fmt = useFormatter();
  const router = useRouter();
  const formError = useFormError("tenant request");
  const [requests, setRequests] = useState<TenantLifecycleRequest[]>(initialRequests);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [effectiveAt, setEffectiveAt] = useState("");
  const [edit, setEdit] = useState<EditForm>(current);
  const [editError, setEditError] = useState<string | undefined>(undefined);
  const noticeRef = useRef<HTMLDivElement>(null);

  // Keep what the server rendered in sync after router.refresh().
  useEffect(() => { setRequests(initialRequests); }, [initialRequests]);
  // Move focus to the result message once a dialog has closed (WCAG 2.4.3 / 3.3.1).
  useEffect(() => {
    if (notice) { const id = window.setTimeout(() => noticeRef.current?.focus(), 0); return () => window.clearTimeout(id); }
    return undefined;
  }, [notice]);

  const actions = availableActions(tenantStatus, requests);
  const direct = actsDirectly(policy);
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

  function close() {
    if (busy) return;
    setDialog(null); setDialogError(undefined); setEditError(undefined); formError.clear();
  }

  async function afterWrite(message: string) {
    setDialog(null); setDialogError(undefined); setNotice(message);
    const latest = await pollRequests(tenantId, listSignature(requests));
    if (latest) setRequests(latest);
    router.refresh();
  }

  async function failWith(res: Response | null) {
    if (!res) { setDialogError(formError.fromException("save", new TypeError("no response")).message); return; }
    const code = knownErrorCode(await errorCodeOf(res));
    if (code) { setDialogError(t(`error.${code}` as never)); return; }
    setDialogError((await formError.fromResponse(res, "save")).message);
  }

  async function submitRequest(body: Record<string, unknown>) {
    setBusy(true); setDialogError(undefined);
    const res = await sendJson("POST", requestsUrl(tenantId), body);
    if (res?.ok) { setBusy(false); await afterWrite(t("submitted")); return; }
    await failWith(res);
    setBusy(false);
  }

  async function submitDecision(request: TenantLifecycleRequest, decision: "approve" | "reject", comment?: string) {
    setBusy(true); setDialogError(undefined);
    const res = await sendJson("POST", decisionUrl(tenantId, request.id), { decision, ...(comment ? { comment } : {}) });
    if (res?.ok) { setBusy(false); await afterWrite(t("decisionSubmitted")); return; }
    await failWith(res);
    setBusy(false);
  }

  async function submitCancel(request: TenantLifecycleRequest, reason?: string) {
    setBusy(true); setDialogError(undefined);
    const res = await sendJson("POST", cancelUrl(tenantId, request.id), { reason });
    if (res?.ok) { setBusy(false); await afterWrite(t("cancelSubmitted")); return; }
    await failWith(res);
    setBusy(false);
  }

  function submitEdit(reason?: string) {
    const check = checkEditForm(edit, current);
    if (!check.ok) {
      setEditError(check.error === "noChange" ? t("editNoChange") : check.error === "name" ? t("editNameInvalid") : t("editDomainInvalid"));
      return;
    }
    setEditError(undefined);
    void submitRequest({ kind: "edit", ...(reason ? { reason } : {}), changes: check.changes });
  }

  const reasonProps = policy.reasonRequired
    ? { requireReason: true as const, minReasonLength: 3, maxReasonLength: 500 }
    : { optionalReason: true as const };
  const note = direct ? t("directNote") : t("secondApproverNote");

  return (
    <>
      <Card title={t("actionsTitle")} padding>
        <p style={{ margin: "0 0 12px", color: "var(--mut)", fontSize: 13 }}>{t("actionsHint")}</p>
        {hasAnyAction(actions) ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {actions.suspend && <Button variant="danger" onClick={() => setDialog({ type: "suspend" })}>{t("suspend")}</Button>}
            {actions.reactivate && <Button variant="primary" onClick={() => setDialog({ type: "reactivate" })}>{t("reactivate")}</Button>}
            {actions.edit && <Button variant="secondary" onClick={() => { setEdit(current); setDialog({ type: "edit" }); }}>{t("edit")}</Button>}
          </div>
        ) : (
          <p style={{ margin: 0 }}>{t("noActionsAvailable", { status: t(`tenantStatus.${tenantStatusKey(tenantStatus)}`) })}</p>
        )}
        <div ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" style={{ marginTop: notice ? 12 : 0, outline: "none" }}>
          {notice}
        </div>
      </Card>

      <Card title={t("requestsTitle")} padding>
        {requestsSource === "error" ? (
          <p role="alert" style={{ margin: 0 }}>{t("requestsLoadFailed")}</p>
        ) : !hasRequests(requests) ? (
          <EmptyState icon="📝" title={t("requestsTitle")} message={t("requestsEmpty")} />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {requests.map((r) => (
              <li key={r.id} style={{ border: "1px solid var(--line, #e5e7eb)", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{t(`kind.${kindKey(r.kind)}`)}</strong>
                  <span className={`pill ${requestTone(r.status)}`}>{t(`requestStatus.${requestStatusKey(r.status)}`)}</span>
                  {r.directExecution && <span className="pill info">{t("appliedDirectly")}</span>}
                </div>
                <div style={{ fontSize: 13, color: "var(--mut)", marginTop: 4 }}>
                  {r.requestedByYou ? t("requestedByYou") : t("requestedByOther")} · {t("requestedOn", { date: when(r.requestedAt) })}
                  {r.effectiveAt ? ` · ${t("effectiveOn", { date: when(r.effectiveAt) })}` : ""}
                </div>
                {r.reason && <div style={{ marginTop: 4, overflowWrap: "anywhere" }}>{t("reasonValue", { reason: r.reason })}</div>}
                {r.kind === "edit" && <div style={{ marginTop: 4, overflowWrap: "anywhere" }}>{t("editChanges", { changes: describeChanges(r.payload) })}</div>}
                {r.status === "pending" && r.requiredApprovals > 1 && (
                  <div style={{ marginTop: 4 }}>{t("approvalsProgress", { count: r.approvalsCount, required: r.requiredApprovals })}</div>
                )}
                {r.decisionReason && <div style={{ marginTop: 4, overflowWrap: "anywhere" }}>{t("decisionReasonValue", { reason: r.decisionReason })}</div>}
                {r.status === "cancelled" && r.cancelReason && (
                  <div style={{ marginTop: 4, overflowWrap: "anywhere" }}>{t("cancelReasonValue", { reason: r.cancelReason })}</div>
                )}
                {r.status === "scheduled" && r.canCancel && (
                  <div style={{ marginTop: 8 }}>
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ type: "cancel", request: r })}>{t("cancel")}</Button>
                  </div>
                )}
                {r.status === "failed" && <div role="note" style={{ marginTop: 4 }}>{t(`failure.${failureKey(r.failureCode)}`)}</div>}
                {r.status === "pending" && (
                  r.canDecide ? (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <Button size="sm" variant="primary" onClick={() => setDialog({ type: "approve", request: r })}>{t("approve")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ type: "reject", request: r })}>{t("reject")}</Button>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 13, color: "var(--mut)" }}>
                      {r.requestedByYou ? t("cannotApproveYours") : t("notEligible")}
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={dialog?.type === "suspend"}
        danger
        title={t("suspendTitle", { name: tenantName })}
        description={<><p>{t("suspendImpact")}</p><p>{note}</p></>}
        confirmLabel={direct ? t("confirmDirect") : t("confirmRequest")}
        reasonLabel={t("reasonLabel")}
        {...reasonProps}
        busy={busy}
        errorMessage={dialogError}
        onCancel={close}
        onConfirm={(reason) => {
          const at = toIsoOrNull(effectiveAt);
          void submitRequest({ kind: "suspend", ...(reason ? { reason } : {}), ...(at ? { effectiveAt: at } : {}) });
        }}
      >
        <Field label={t("effectiveAtLabel")}>
          <Input type="datetime-local" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
        </Field>
        <p style={{ fontSize: 12, color: "var(--mut)", margin: "4px 0 8px" }}>{t("effectiveAtHint")}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === "reactivate"}
        title={t("reactivateTitle", { name: tenantName })}
        description={<><p>{t("reactivateImpact")}</p><p>{note}</p></>}
        confirmLabel={direct ? t("confirmDirect") : t("confirmRequest")}
        reasonLabel={t("reasonLabel")}
        {...reasonProps}
        busy={busy}
        errorMessage={dialogError}
        onCancel={close}
        onConfirm={(reason) => void submitRequest({ kind: "reactivate", ...(reason ? { reason } : {}) })}
      />

      <ConfirmDialog
        open={dialog?.type === "edit"}
        title={t("editTitle", { name: tenantName })}
        description={<><p>{t("editImpact")}</p><p>{note}</p></>}
        confirmLabel={direct ? t("confirmDirect") : t("confirmRequest")}
        reasonLabel={t("reasonLabel")}
        {...reasonProps}
        busy={busy}
        errorMessage={dialogError ?? editError}
        onCancel={close}
        onConfirm={(reason) => submitEdit(reason)}
      >
        <Field label={t("nameLabel")}>
          <Input value={edit.name} maxLength={200} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
        </Field>
        <Field label={t("domainLabel")}>
          <Input value={edit.domain} maxLength={253} onChange={(e) => setEdit({ ...edit, domain: e.target.value })} />
        </Field>
        <Field label={t("editionLabel")}>
          <Select value={edit.edition} onChange={(e) => setEdit({ ...edit, edition: e.target.value })}>
            {EDITIONS.map((ed) => <option key={ed} value={ed}>{t(`edition.${ed}`)}</option>)}
          </Select>
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === "approve"}
        title={t("approveTitle")}
        description={<p>{t("approveBody")}</p>}
        confirmLabel={t("approveConfirm")}
        reasonLabel={t("approveNote")}
        optionalReason
        busy={busy}
        errorMessage={dialogError}
        onCancel={close}
        onConfirm={(comment) => { if (dialog?.type === "approve") void submitDecision(dialog.request, "approve", comment); }}
      />

      <ConfirmDialog
        open={dialog?.type === "reject"}
        danger
        title={t("rejectTitle")}
        description={<p>{t("rejectBody")}</p>}
        confirmLabel={t("rejectConfirm")}
        reasonLabel={t("rejectReasonLabel")}
        requireReason
        minReasonLength={3}
        maxReasonLength={1000}
        busy={busy}
        errorMessage={dialogError}
        onCancel={close}
        onConfirm={(comment) => { if (dialog?.type === "reject") void submitDecision(dialog.request, "reject", comment); }}
      />

      <ConfirmDialog
        open={dialog?.type === "cancel"}
        danger
        title={t("cancelTitle")}
        description={<p>{t("cancelBody")}</p>}
        confirmLabel={t("cancelConfirm")}
        reasonLabel={t("cancelReasonLabel")}
        requireReason
        minReasonLength={3}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError}
        onCancel={close}
        onConfirm={(reason) => { if (dialog?.type === "cancel") void submitCancel(dialog.request, reason); }}
      />
    </>
  );
}
