"use client";

/**
 * UX R1 decision panel: the business record, the approval trail and the decision, in one place.
 * Every decision goes through the existing workflow commands (POST /v1/workflow/tasks/:id/complete,
 * /forward); the server re-checks role, assignee and segregation of duties and stays the authority.
 * The SoD and "not yours" states here only explain, before the round-trip, what the server enforces.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useToastOptional } from "@/app/_components/ds";
import { DirectoryPicker } from "@/app/_components/DirectoryPicker";
import { formatDateTimeIST, formatIndianDate } from "@/lib/formatters";
import { humanErrorFromFailure, messageForThrown } from "@/lib/messages";
import { formatReference, referenceFromHeaders } from "@/lib/errorCatalogue";
import { personLabel, presentable, recordHref, type InboxRow, type InboxTab, type Person, type RefSummary } from "../_lib/inboxModel";
import { amountText, slaText, slaTone, stageText, taskTitle, type T } from "./rowText";
import styles from "./inbox.module.css";

export type DecisionKind = "approve" | "return" | "reject" | "forward";

export type TaskContext = {
  task: { id: string; name: string; status: string; decision: string | null; refType: string | null; refId: string | null; instanceId: string; dueAt: string | null; createdAt: string | null; assigned: boolean };
  instance: { id: string; name: string; status: string; createdAt: string };
  maker: Person | null;
  isMaker: boolean;
  summary: RefSummary | null;
  trail: Array<{ action: string; decision: string | null; step: string | null; actor: Person | null; remarks: string | null; at: string }>;
  permissions: { canAct: boolean; blockedReason: "notPending" | "assignedToOther" | "notYourRole" | null; sodBlock: "maker" | "repeatActor" | null; canForward: boolean };
};

type Guards = { state: "none" } | { state: "loading" } | { state: "unavailable" } | { state: "ok"; zeroBasic: number; arrears: number };

export interface DecisionPanelProps {
  row: InboxRow;
  tab: InboxTab;
  /** Called after the server accepted a decision; the inbox removes the row and opens the next. */
  onDecided: (taskId: string, decision: DecisionKind, message: string) => void;
  onClose: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

async function readCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

const REMARKS_MAX = 500;

export function DecisionPanel({ row, tab, onDecided, onClose, headingRef, fetchImpl }: DecisionPanelProps) {
  const t = useTranslations("approvalsInbox") as unknown as T;
  const toast = useToastOptional();
  const doFetch = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ids = useId();
  const remarksId = `${ids}-remarks`;
  const remarksHintId = `${ids}-remarks-hint`;
  const remarksErrId = `${ids}-remarks-err`;
  const sodId = `${ids}-sod`;
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; reference: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [guards, setGuards] = useState<Guards>({ state: "none" });
  const [remarks, setRemarks] = useState("");
  const [remarksError, setRemarksError] = useState(false);
  const [confirming, setConfirming] = useState<Exclude<DecisionKind, "forward"> | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [forwardTo, setForwardTo] = useState<string | null>(null);
  const [forwardError, setForwardError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<{ message: string; reference: string } | null>(null);
  const remarksRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const title = taskTitle(t, row);
  const taskId = row.task.id;

  // Load the decision context for the selected task (participants only; 404 otherwise).
  useEffect(() => {
    const ac = new AbortController();
    setCtx(null);
    setLoadError(null);
    setGuards({ state: "none" });
    setRemarks("");
    setRemarksError(false);
    setConfirming(null);
    setForwarding(false);
    setForwardTo(null);
    setActionError(null);
    (async () => {
      try {
        const res = await doFetch(`/api/proxy/v1/workflow/inbox/tasks/${encodeURIComponent(taskId)}/context`, { signal: ac.signal });
        if (!res.ok) {
          const h = humanErrorFromFailure({ status: res.status, code: await readCode(res), kind: "load", area: t("panel.detailsErrorArea") });
          setLoadError({ message: `${h.what} ${h.next}`, reference: formatReference(referenceFromHeaders(res.headers)) });
          return;
        }
        const body = (await res.json()) as { data?: TaskContext };
        if (!body.data) throw new Error("empty");
        setCtx(body.data);
      } catch (err) {
        if (ac.signal.aborted) return;
        const m = messageForThrown(err, { kind: "load", area: t("panel.detailsErrorArea") });
        if (!m.aborted) setLoadError({ message: m.message, reference: formatReference(m.reference) });
      }
    })();
    return () => ac.abort();
    // doFetch/t are stable for a mounted panel; reload re-runs the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, reload]);

  // Payroll guard results (ZERO_BASIC / ARREARS_REVIEW), only where the module provides them.
  useEffect(() => {
    if (!ctx || ctx.task.refType !== "payroll_run" || !ctx.task.refId || tab !== "waiting") return;
    const ac = new AbortController();
    setGuards({ state: "loading" });
    (async () => {
      try {
        const res = await doFetch(`/api/proxy/v1/payroll/runs/${encodeURIComponent(ctx.task.refId!)}/approval-review`, { signal: ac.signal });
        if (!res.ok) { setGuards({ state: "unavailable" }); return; }
        const raw = (await res.json()) as Record<string, unknown>;
        const body = (raw && typeof raw === "object" && "data" in raw ? raw.data : raw) as { zeroBasic?: unknown[]; arrears?: { employees?: Array<{ requiresReview?: boolean }> } };
        setGuards({
          state: "ok",
          zeroBasic: Array.isArray(body?.zeroBasic) ? body.zeroBasic.length : 0,
          arrears: Array.isArray(body?.arrears?.employees) ? body.arrears.employees.filter((e) => e?.requiresReview).length : 0,
        });
      } catch {
        if (!ac.signal.aborted) setGuards({ state: "unavailable" });
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, tab]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const fail = useCallback(async (res: Response) => {
    const h = humanErrorFromFailure({ status: res.status, code: await readCode(res), kind: "save", area: t("panel.errorArea") });
    setActionError({ message: `${h.what} ${h.next}`, reference: formatReference(referenceFromHeaders(res.headers)) });
  }, [t]);

  const submit = useCallback(async (decision: Exclude<DecisionKind, "forward">) => {
    setBusy(true);
    setActionError(null);
    try {
      const reason = remarks.trim();
      const res = await doFetch(`/api/proxy/v1/workflow/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) { await fail(res); return; }
      const key = decision === "approve" ? "panel.toastApprove" : decision === "return" ? "panel.toastReturn" : "panel.toastReject";
      const message = t(key, { title });
      if (decision === "reject") toast?.toast.info(message);
      else toast?.toast.success(message);
      onDecided(taskId, decision, message);
    } catch (err) {
      const m = messageForThrown(err, { kind: "save", area: t("panel.errorArea") });
      if (!m.aborted) setActionError({ message: m.message, reference: formatReference(m.reference) });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remarks, taskId, title, fail, onDecided, toast, t]);

  const submitForward = useCallback(async () => {
    if (!forwardTo) { setForwardError(true); return; }
    setBusy(true);
    setActionError(null);
    try {
      const reason = remarks.trim();
      const res = await doFetch(`/api/proxy/v1/workflow/tasks/${encodeURIComponent(taskId)}/forward`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserId: forwardTo, ...(reason ? { remarks: reason } : {}) }),
      });
      if (!res.ok) { await fail(res); return; }
      const message = t("panel.toastForward", { title });
      toast?.toast.success(message);
      onDecided(taskId, "forward", message);
    } catch (err) {
      const m = messageForThrown(err, { kind: "save", area: t("panel.errorArea") });
      if (!m.aborted) setActionError({ message: m.message, reference: formatReference(m.reference) });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forwardTo, remarks, taskId, title, fail, onDecided, toast, t]);

  function start(decision: Exclude<DecisionKind, "forward">) {
    setActionError(null);
    if ((decision === "return" || decision === "reject") && !remarks.trim()) {
      setRemarksError(true);
      remarksRef.current?.focus();
      return;
    }
    setRemarksError(false);
    setConfirming(decision);
  }

  const summary = ctx?.summary ?? row.summary;
  const href = recordHref(row.task.refType, row.task.refId, summary?.parentId);
  const perms = ctx?.permissions;
  const decidable = tab === "waiting" && !!perms?.canAct;
  const sodReason = perms?.sodBlock === "maker" ? t("panel.sodMaker") : perms?.sodBlock === "repeatActor" ? t("panel.sodRepeatActor") : null;
  const blockedText = perms?.blockedReason === "notPending" ? t("panel.blockedNotPending")
    : perms?.blockedReason === "assignedToOther" ? t("panel.blockedAssignedToOther")
    : perms?.blockedReason === "notYourRole" ? t("panel.blockedNotYourRole") : null;
  const guardText = guards.state === "ok"
    ? [guards.zeroBasic > 0 ? t("panel.checksZeroBasic", { count: guards.zeroBasic }) : null, guards.arrears > 0 ? t("panel.checksArrears", { count: guards.arrears }) : null].filter(Boolean).join(" ")
    : "";
  const guardBlocks = guards.state === "loading" || guards.state === "unavailable" || (guards.state === "ok" && guardText.length > 0);
  const approveDisabled = busy || !!sodReason || guardBlocks;
  const statusText = tab === "done" ? t("panel.statusDecided") : tab === "sent" ? t("panel.statusWithOther") : t("panel.statusAwaiting");
  const fields = summary?.fields ?? [];
  const nr = t("notRecorded");

  return (
    <section className={styles.panel} aria-labelledby={`${ids}-h`} aria-busy={!ctx && !loadError}>
      <div className={styles.panelHead}>
        <div>
          <span className={styles.typeChip}>{t(`types.${row.type}`)} · {t(`modules.${row.module}`)}</span>
          <h2 id={`${ids}-h`} ref={headingRef} tabIndex={-1}>{title}</h2>
          <span className={`pill ${tab === "waiting" ? "info" : "mut"}`}>{statusText}</span>
        </div>
        <button type="button" className="btn ghost sm" onClick={onClose}>{t("panel.close")}</button>
      </div>

      <div className={styles.section}>
        <h3>{t("panel.facts")}</h3>
        <dl className={styles.dl}>
          <dt>{t("panel.reference")}</dt><dd>{row.reference ?? nr}</dd>
          <dt>{t("panel.amount")}</dt><dd className={styles.num}>{amountText(t, row.amountMinor)}</dd>
          <dt>{t("panel.raisedBy")}</dt><dd>{personLabel(ctx?.maker ?? row.maker) ?? t("nameNotRecorded")}</dd>
          <dt>{t("panel.raisedOn")}</dt><dd>{ctx ? formatIndianDate(ctx.instance.createdAt) : row.task.createdAt ? formatIndianDate(row.task.createdAt) : nr}</dd>
          <dt>{t("panel.currentStage")}</dt><dd>{stageText(t, summary?.stage) ?? nr}</dd>
          {tab !== "done" && (<><dt>{t("panel.due")}</dt><dd><span className={`pill ${slaTone(row.sla.state)}`}>{slaText(t, row.sla, row.task.dueAt)}</span></dd></>)}
          {fields.map((f) => (
            <FieldRow key={f.key} label={t(`panel.fields.${f.key}`)} value={f.key.endsWith("Date") ? formatIndianDate(f.value) : presentable(f.value) ?? nr} />
          ))}
        </dl>
        {href && <Link href={href} className="btn ghost sm">{t("panel.viewRecord")}</Link>}
        {summary && summary.kind === "generic" && !fields.length && <p className={styles.muted}>{t("panel.noBusiness")}</p>}
      </div>

      {guards.state !== "none" && (
        <div className={styles.section} role="group" aria-labelledby={`${ids}-checks`}>
          <h3 id={`${ids}-checks`}>{t("panel.checks")}</h3>
          <p className={guardBlocks ? styles.notice : styles.muted} role="status">
            {guards.state === "loading" ? t("panel.loading") : guards.state === "unavailable" ? t("panel.checksUnavailable") : guardText || t("panel.checksClear")}
          </p>
        </div>
      )}

      <div className={styles.section}>
        <h3>{t("panel.trail")}</h3>
        {!ctx && !loadError && <p className={styles.muted} role="status">{t("panel.loading")}</p>}
        {loadError && (
          <div role="alert" className={styles.notice}>
            <p style={{ margin: 0 }}>{loadError.message}</p>
            {loadError.reference && <p className={styles.muted} style={{ margin: "4px 0 0" }}>{loadError.reference}</p>}
            <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setReload((n) => n + 1)}>{t("panel.retry")}</button>
          </div>
        )}
        {ctx && ctx.trail.length === 0 && <p className={styles.muted}>{t("panel.trailEmpty")}</p>}
        {ctx && ctx.trail.length > 0 && (
          <ol className={styles.trail}>
            {ctx.trail.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <strong>{personLabel(e.actor) ?? t("nameNotRecorded")}</strong>
                {" · "}{t(`panel.action.${e.action}`)}
                {presentable(e.step) ? ` · ${presentable(e.step)}` : ""}
                <span className={styles.sub}><time dateTime={e.at}>{formatDateTimeIST(e.at)}</time></span>
                {presentable(e.remarks) && <blockquote className={styles.remarksQuote}>{e.remarks}</blockquote>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {tab === "waiting" && ctx && (
        <div className={styles.section}>
          {blockedText && <p className={styles.notice} role="status">{blockedText}</p>}
          {decidable && (
            <>
              {sodReason && <p id={sodId} className={styles.notice} role="status">{sodReason}</p>}
              <label htmlFor={remarksId} style={{ fontWeight: 650, display: "block", marginBottom: 4 }}>{t("panel.remarks")}</label>
              <p id={remarksHintId} className={styles.muted} style={{ margin: "0 0 6px" }}>{t("panel.remarksHint")}</p>
              <textarea
                id={remarksId}
                ref={remarksRef}
                className={styles.textarea}
                value={remarks}
                maxLength={REMARKS_MAX}
                aria-invalid={remarksError}
                aria-describedby={remarksError ? `${remarksHintId} ${remarksErrId}` : remarksHintId}
                onChange={(e) => { setRemarks(e.target.value); if (e.target.value.trim()) setRemarksError(false); }}
                disabled={busy || !!sodReason}
              />
              {remarksError && <p id={remarksErrId} className={styles.error} role="alert">{t("panel.remarksRequired")}</p>}

              <div className={styles.actions}>
                <button type="button" className="btn primary" disabled={approveDisabled} aria-disabled={approveDisabled}
                  aria-describedby={sodReason ? sodId : undefined} onClick={() => start("approve")}>{t("panel.approve")}</button>
                <button type="button" className="btn ghost" disabled={busy || !!sodReason} onClick={() => start("return")}>{t("panel.return")}</button>
                <button type="button" className="btn ghost" style={{ color: "var(--bad)" }} disabled={busy || !!sodReason} onClick={() => start("reject")}>{t("panel.reject")}</button>
                {perms?.canForward && (
                  <button type="button" className="btn ghost" disabled={busy} aria-expanded={forwarding} onClick={() => setForwarding((v) => !v)}>{t("panel.forward")}</button>
                )}
              </div>

              {confirming && (
                <div className={styles.confirm} role="group" aria-label={t("panel.confirmYes")}>
                  <p style={{ margin: "0 0 8px" }}>
                    {t(confirming === "approve" ? "panel.confirmApprove" : confirming === "return" ? "panel.confirmReturn" : "panel.confirmReject", { title })}
                  </p>
                  <div className={styles.actions} style={{ marginTop: 0 }}>
                    <button ref={confirmRef} type="button" className={`btn ${confirming === "reject" ? "danger" : "primary"} sm`} disabled={busy} onClick={() => void submit(confirming)}>
                      {busy ? t("panel.working") : t("panel.confirmYes")}
                    </button>
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setConfirming(null)}>{t("panel.cancel")}</button>
                  </div>
                </div>
              )}

              {forwarding && perms?.canForward && (
                <div className={styles.confirm}>
                  <label htmlFor={`${ids}-fwd`} style={{ fontWeight: 650, display: "block", marginBottom: 4 }}>{t("panel.forwardTo")}</label>
                  <DirectoryPicker source="user" id={`${ids}-fwd`} value={forwardTo} onChange={(v) => { setForwardTo(v); setForwardError(false); }}
                    aria-invalid={forwardError} aria-describedby={forwardError ? `${ids}-fwd-err` : undefined} />
                  {forwardError && <p id={`${ids}-fwd-err`} className={styles.error} role="alert">{t("panel.forwardPick")}</p>}
                  <div className={styles.actions}>
                    <button type="button" className="btn primary sm" disabled={busy} onClick={() => void submitForward()}>{busy ? t("panel.working") : t("panel.forwardSubmit")}</button>
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setForwarding(false)}>{t("panel.cancel")}</button>
                  </div>
                </div>
              )}

              {actionError && (
                <div role="alert" className={styles.notice}>
                  <p style={{ margin: 0 }}>{actionError.message}</p>
                  {actionError.reference && <p className={styles.muted} style={{ margin: "4px 0 0" }}>{actionError.reference}</p>}
                </div>
              )}
              <p className={styles.muted} style={{ marginTop: 10 }}>{t("panel.after")}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (<><dt>{label}</dt><dd>{value}</dd></>);
}
