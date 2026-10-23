"use client";

/**
 * "My delegations" (client). Create a role-scoped, time-boxed delegation, see active/expired ones, revoke an active one.
 *
 * API (workflow-service, via /api/proxy): POST/GET/DELETE /v1/workflow/delegations. Writes are CQRS: a 202 means
 * "received", so after each write this panel polls the list (bounded) until the change is visible, never faking success.
 * The service scopes the list to the caller: ?mine=true returns delegations the caller created (delegator) and
 * ?toMe=true those handed to the caller (delegate), so there is no client-side filtering or row window.
 * The role picker offers only roles the user holds (from the session); the service re-checks them against the token.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AcceptedNotice, Button, Card, ConfirmDialog, DataTable, EmptyState, EntityPicker, ErrorState, Field, Input, PageHeader,
  SkeletonTable, Textarea,
} from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";
import { humaniseCode } from "@/lib/labels";
import { formatIndianDate, formatShortId, todayIST } from "@/lib/formatters";
import { searchDirectoryUsers, resolveDirectoryUsers } from "@/lib/directory/searchUsers";
import {
  MAX_DELEGATION_DAYS, MAX_REASON_LENGTH, addDays, delegationState, heldRoleList, isDelegationErrorCode, parseDelegationList,
  validateDelegationForm, type Delegation, type DelegationFormErrors, type DelegationState,
} from "../_data/delegations";

const LIST_URL = "/api/proxy/v1/workflow/delegations";
const LIST_LIMIT = 200;

/** "mine" = I am the delegator (can revoke); "toMe" = I am the delegate (read-only). */
type View = "mine" | "toMe";

type Loaded = { rows: Delegation[]; total: number };
type ListState = { status: "loading" } | { status: "error" } | ({ status: "ready" } & Loaded);

async function fetchDelegations(view: View = "mine"): Promise<Loaded> {
  const res = await fetch(`${LIST_URL}?limit=${LIST_LIMIT}&${view === "mine" ? "mine=true" : "toMe=true"}`, { cache: "no-store" });
  if (!res.ok) throw new Error("LIST_UNAVAILABLE");
  const parsed = parseDelegationList(await res.json());
  if (!parsed) throw new Error("LIST_UNEXPECTED_BODY");
  return parsed;
}

export interface DelegationsPanelProps {
  /** Signed-in user id (JWT sub). */
  userId: string | null;
  /** Roles the signed-in user holds (JWT roles). */
  roles: readonly string[];
  /** Show the link to the admin legacy report. */
  canViewLegacy?: boolean;
  /** Delay before the first confirmation poll; tests shorten it. */
  pollDelayMs?: number;
}

const PILL: Record<DelegationState, string> = { active: "good", upcoming: "info", expired: "mut", revoked: "bad" };

export function DelegationsPanel({ userId, roles, canViewLegacy = false, pollDelayMs }: DelegationsPanelProps) {
  const t = useTranslations("workflowDelegations");
  const heldRoles = useMemo(() => heldRoleList(roles), [roles]);
  const today = todayIST();

  // ---- list ---------------------------------------------------------------
  const [view, setView] = useState<View>("mine");
  const viewRef = useRef<View>("mine");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [names, setNames] = useState<Map<string, string>>(new Map());

  const apply = useCallback((l: Loaded) => setList({ status: "ready", ...l }), []);
  const load = useCallback(async (v?: View) => {
    const target = v ?? viewRef.current;
    setList({ status: "loading" });
    try {
      const loaded = await fetchDelegations(target);
      if (viewRef.current === target) apply(loaded);
    } catch {
      if (viewRef.current === target) setList({ status: "error" });
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  function switchView(next: View) {
    if (next === viewRef.current) return;
    viewRef.current = next;
    setView(next);
    void load(next);
  }

  /** Rows are already scoped by the service to the active view. */
  const rows = useMemo(() => (list.status === "ready" ? list.rows : []), [list]);
  /** The other party: the delegate on "mine", the delegator on "toMe". */
  const personIdOf = useCallback((r: Delegation) => (view === "mine" ? r.delegateId : r.delegatorId), [view]);

  useEffect(() => {
    const ids = rows.map(personIdOf);
    if (ids.length === 0) return;
    let live = true;
    void resolveDirectoryUsers(ids).then((opts) => {
      if (live) setNames(new Map(opts.map((o) => [o.id, o.label])));
    });
    return () => { live = false; };
  }, [rows, personIdOf]);

  const nameOf = useCallback(
    (id: string) => names.get(id) ?? t("unknownPerson", { id: formatShortId(id) }),
    [names, t],
  );

  // ---- writes: 202 then bounded poll of the list -----------------------------
  const pollOpts = pollDelayMs !== undefined ? { initialDelayMs: pollDelayMs } : {};
  const created = useAcceptedWrite<string, Loaded>({
    ...pollOpts,
    poll: () => fetchDelegations("mine"),
    isDone: (l, id) => l.rows.some((r) => r.id === id),
    onConfirmed: (l) => { if (viewRef.current === "mine") apply(l); },
  });
  const revoked = useAcceptedWrite<string, Loaded>({
    ...pollOpts,
    poll: () => fetchDelegations("mine"),
    isDone: (l, id) => !l.rows.some((r) => r.id === id && r.isActive),
    onConfirmed: (l) => { if (viewRef.current === "mine") apply(l); },
  });
  const formError = useFormError("delegation");

  /** Plain-language message for a failed write. Known codes get this screen's copy; the server text is never shown. */
  const failureMessage = useCallback(async (res: Response): Promise<string> => {
    let code: unknown;
    try { code = ((await res.clone().json()) as { code?: unknown }).code; } catch { /* non-JSON body */ }
    if (isDelegationErrorCode(code)) return t(`err_${code}`, { max: MAX_DELEGATION_DAYS });
    if (code === "NOT_FOUND") return t("err_NOT_FOUND");
    return (await formError.fromResponse(res, "save")).message;
  }, [formError, t]);

  // ---- form -----------------------------------------------------------------
  const [pickedRoles, setPickedRoles] = useState<string[]>([]);
  const [delegateId, setDelegateId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  const errors: DelegationFormErrors = validateDelegationForm(
    { roles: pickedRoles, delegateId, fromDate, toDate, reason },
    { heldRoles, userId },
  );
  // Date and reason problems show as soon as the field has a value; the "nothing chosen yet" ones wait for a submit.
  const dateLive = (v: string) => v !== "";
  const shown: DelegationFormErrors = {
    ...(submitted && errors.roles ? { roles: errors.roles } : {}),
    ...(submitted && errors.delegate ? { delegate: errors.delegate } : {}),
    ...(errors.fromDate && (submitted || dateLive(fromDate)) ? { fromDate: errors.fromDate } : {}),
    ...(errors.toDate && (submitted || dateLive(toDate)) ? { toDate: errors.toDate } : {}),
    ...(errors.reason ? { reason: errors.reason } : {}),
  };
  const msg = (k: keyof DelegationFormErrors): string | undefined => {
    const key = shown[k];
    if (!key) return undefined;
    return t(key, { max: key === "rolesTooMany" ? 20 : key === "reasonTooLong" ? MAX_REASON_LENGTH : MAX_DELEGATION_DAYS, latest: formatIndianDate(addDays(fromDate, MAX_DELEGATION_DAYS)) });
  };
  const latestTo = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? addDays(fromDate, MAX_DELEGATION_DAYS) : undefined;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError("");
    if (Object.keys(errors).length > 0 || !delegateId) return;
    setSubmitting(true);
    try {
      const res = await fetch(LIST_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          delegateId,
          roles: pickedRoles,
          fromDate,
          toDate,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        setServerError(await failureMessage(res));
        return;
      }
      let id = "";
      try { id = String(((await res.json()) as { id?: unknown }).id ?? ""); } catch { /* 202 without a body */ }
      setPickedRoles([]);
      setDelegateId(null);
      setToDate("");
      setReason("");
      setSubmitted(false);
      void created.accept(id);
    } catch (caught) {
      setServerError(formError.fromException("save", caught).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- revoke ---------------------------------------------------------------
  const [revoking, setRevoking] = useState<Delegation | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | undefined>(undefined);

  async function confirmRevoke() {
    if (!revoking) return;
    setRevokeBusy(true);
    setRevokeError(undefined);
    try {
      const res = await fetch(`${LIST_URL}/${encodeURIComponent(revoking.id)}`, { method: "DELETE" });
      if (!res.ok) {
        setRevokeError(await failureMessage(res));
        return;
      }
      const id = revoking.id;
      setRevoking(null);
      void revoked.accept(id);
    } catch (caught) {
      setRevokeError(formError.fromException("save", caught).message);
    } finally {
      setRevokeBusy(false);
    }
  }

  // ---- render ---------------------------------------------------------------
  const active = rows.filter((r) => ["active", "upcoming"].includes(delegationState(r, today)));
  const history = rows.filter((r) => ["expired", "revoked"].includes(delegationState(r, today)));
  const isMine = view === "mine";

  const columns = (withActions: boolean) => [
    { key: "delegateId" as const, label: isMine ? t("colDelegate") : t("colDelegator"), render: (r: Delegation) => nameOf(personIdOf(r)) },
    {
      key: "roles" as const, label: t("colRoles"),
      render: (r: Delegation) => (
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          {r.roles.map((role) => <span key={role} className="pill mut">{humaniseCode(role)}</span>)}
        </span>
      ),
    },
    { key: "fromDate" as const, label: t("colFrom"), render: (r: Delegation) => formatIndianDate(r.fromDate) },
    { key: "toDate" as const, label: t("colTo"), render: (r: Delegation) => formatIndianDate(r.toDate) },
    { key: "reason" as const, label: t("colReason"), render: (r: Delegation) => r.reason ?? "—" },
    {
      key: "isActive" as const, label: t("colStatus"),
      render: (r: Delegation) => {
        const s = delegationState(r, today);
        return <span className={`pill ${PILL[s]}`}>{t(`status_${s}`)}</span>;
      },
    },
    ...(withActions
      ? [{
          key: "id" as const, label: t("colActions"),
          render: (r: Delegation) => (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t("revokeAria", { name: nameOf(r.delegateId) })}
              onClick={() => { setRevokeError(undefined); setRevoking(r); }}
            >
              {t("revoke")}
            </Button>
          ),
        }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/workflow"
        actions={canViewLegacy ? <Link href="/workflow/delegations/legacy" className="btn ghost">{t("legacyLink")}</Link> : null}
      />

      <div className="seg" role="tablist" aria-label={t("tabsAria")} style={{ marginBottom: 14 }}>
        {(["mine", "toMe"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`deleg-tab-${v}`}
            aria-selected={view === v}
            aria-controls="deleg-tabpanel"
            className={view === v ? "on" : undefined}
            onClick={() => switchView(v)}
          >
            {t(v === "mine" ? "tabMine" : "tabToMe")}
          </button>
        ))}
      </div>

      {isMine ? (
      <Card title={t("formTitle")} padding>
        <form onSubmit={(e) => void onSubmit(e)} noValidate aria-label={t("formTitle")} style={{ display: "grid", gap: 14, maxWidth: 640 }}>
          <fieldset
            aria-describedby={shown.roles ? "deleg-roles-error" : "deleg-roles-help"}
            aria-invalid={shown.roles ? true : undefined}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <legend className="label">{t("rolesLabel")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span></legend>
            {heldRoles.length === 0 ? (
              <p className="mut" style={{ margin: "4px 0" }}>{t("rolesNone")}</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 6 }}>
                {heldRoles.map((role) => (
                  <label key={role} style={{ display: "inline-flex", gap: 6, alignItems: "center", minHeight: 24 }}>
                    <input
                      type="checkbox"
                      checked={pickedRoles.includes(role)}
                      onChange={(e) => setPickedRoles((cur) => (e.target.checked ? [...cur, role] : cur.filter((r) => r !== role)))}
                    />
                    {humaniseCode(role)}
                  </label>
                ))}
              </div>
            )}
            <p id="deleg-roles-help" className="mut" style={{ margin: "6px 0 0", fontSize: 12 }}>{t("rolesHelp")}</p>
            {shown.roles ? <p id="deleg-roles-error" role="alert" style={{ margin: "4px 0 0", color: "var(--bad)", fontSize: 13 }}>{msg("roles")}</p> : null}
          </fieldset>

          <Field label={t("delegateLabel")} id="deleg-delegate" required {...(msg("delegate") ? { error: msg("delegate")! } : {})}>
            <EntityPicker
              value={delegateId}
              onChange={(v) => setDelegateId(Array.isArray(v) ? (v[0] ?? null) : v)}
              search={(q, signal) => searchDirectoryUsers(q, signal, { strict: true })}
              resolve={resolveDirectoryUsers}
              minQueryLength={2}
              placeholder={t("delegatePlaceholder")}
              searchingText={t("delegateSearching")}
              noResultsText={t("delegateNoResults")}
              searchErrorText={t("delegateSearchError")}
              searchRetryLabel={t("retry")}
            />
          </Field>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Field label={t("fromLabel")} id="deleg-from" required style={{ flex: "1 1 180px" }} {...(msg("fromDate") ? { error: msg("fromDate")! } : {})}>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label={t("toLabel")} id="deleg-to" required style={{ flex: "1 1 180px" }} {...(msg("toDate") ? { error: msg("toDate")! } : {})}>
              <Input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                max={latestTo}
                onChange={(e) => setToDate(e.target.value)}
              />
            </Field>
          </div>
          <p className="mut" style={{ margin: "-6px 0 0", fontSize: 12 }}>{t("toHelp", { max: MAX_DELEGATION_DAYS })}</p>

          <Field label={t("reasonLabel")} id="deleg-reason" {...(msg("reason") ? { error: msg("reason")! } : {})}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <p className="mut" style={{ margin: "-6px 0 0", fontSize: 12 }}>{t("reasonHelp", { max: MAX_REASON_LENGTH })}</p>

          {serverError ? <p role="alert" style={{ margin: 0, color: "var(--bad)", fontSize: 14 }}>{serverError}</p> : null}

          <div><Button type="submit" variant="primary" disabled={submitting}>{submitting ? t("submitting") : t("submit")}</Button></div>
        </form>
        <AcceptedNotice {...created.noticeProps} onRefresh={() => void load()} message={t("createdMessage")} />
      </Card>
      ) : null}

      {isMine ? <AcceptedNotice {...revoked.noticeProps} onRefresh={() => void load()} message={t("revokedMessage")} /> : null}

      <div id="deleg-tabpanel" role="tabpanel" aria-labelledby={`deleg-tab-${view}`}>

      {list.status === "loading" ? (
        <div role="status" aria-busy="true" style={{ marginTop: 18 }}>
          <span className="sr-only">{t("loading")}</span>
          <SkeletonTable rows={4} statCards={0} quiet />
        </div>
      ) : list.status === "error" ? (
        <div style={{ marginTop: 18 }}>
          <ErrorState
            error={{ what: t("loadError"), next: t("loadErrorNext"), actions: ["retry"] }}
            onRetry={() => void load()}
          />
        </div>
      ) : (
        <>
          <div style={{ marginTop: 18 }}>
            <Card title={t("activeTitle")}>
              {active.length === 0 ? (
                <div className="pad"><EmptyState icon="🤝" title={t("emptyActiveTitle")} message={isMine ? t("emptyActiveMessage") : t("emptyToMeMessage")} /></div>
              ) : (
                <div className="pad"><DataTable<Delegation> columns={columns(isMine)} rows={active} rowKey={(r) => r.id} /></div>
              )}
            </Card>
          </div>
          <div style={{ marginTop: 18 }}>
            <Card title={t("historyTitle")}>
              {history.length === 0 ? (
                <div className="pad"><EmptyState icon="🗂️" title={t("emptyHistoryTitle")} message={t("emptyHistoryMessage")} /></div>
              ) : (
                <div className="pad"><DataTable<Delegation> columns={columns(false)} rows={history} rowKey={(r) => r.id} /></div>
              )}
            </Card>
          </div>
        </>
      )}

      </div>

      {revoking ? (
        <ConfirmDialog
          open
          danger
          title={t("revokeTitle")}
          description={t("revokeDescription", { name: nameOf(revoking.delegateId) })}
          confirmLabel={t("revokeConfirm")}
          busy={revokeBusy}
          {...(revokeError ? { errorMessage: revokeError } : {})}
          onConfirm={() => void confirmRevoke()}
          onCancel={() => { if (!revokeBusy) setRevoking(null); }}
        />
      ) : null}
    </>
  );
}
