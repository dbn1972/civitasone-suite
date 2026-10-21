"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton, Button, Modal } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getEscalationUsers, type EscalationUser } from "@/lib/crm/activityAccount";

/**
 * Plain-language failure message for a failed service-request status
 * transition. `setStatus` is a plain async helper, not a component or hook,
 * so it can't call the useFormError hook; toHumanError is the same
 * catalogued-message building block that hook is built on -- never the
 * backend's own message/error text or the raw HTTP status. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function serviceRequestActionError(): string {
  const human = toHumanError("save", { area: "service request" });
  return `${human.what} ${human.next}`;
}

/**
 * Service request lifecycle actions.
 *
 * The service exposes PATCH /v1/crm/service-requests/:id/status but nothing in
 * the UI called it, so a request could be raised and then never progressed.
 * Each transition is a single decision taken inline; the reason captured by
 * ConfirmDialog is stored as the resolution note.
 *
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-03: the PATCH now carries the `version` the
 * page read, so a stale write (another officer already advanced the request) is
 * rejected server-side with 409 rather than silently overwriting. A conflict is
 * surfaced as a plain-language "reload" message and the page is refreshed.
 */
export function ServiceRequestActions({
  id,
  status,
  version,
  assignedTo = null,
  assignedToName = null,
  canAssign = false,
}: {
  id: string;
  status: string;
  version?: number;
  /** GAP-CRM-SERVICE-REQUESTS-DETAIL-05: the current owner, so Assign can offer "Reassign". */
  assignedTo?: string | null;
  assignedToName?: string | null;
  /** Whether the viewer may assign (managers only; the server enforces the same rule). */
  canAssign?: boolean;
}) {
  const t = useTranslations("crmServiceRequestActions");
  const router = useRouter();
  // GAP-CRM-SERVICE-REQUESTS-DETAIL-04: what the server said happens to the citizen notice
  // after a resolve/close, so the officer never assumes a citizen was told.
  const [notice, setNotice] = useState<string | undefined>(undefined);

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-05: "cancelled" is a terminal state, so a
  // Cancel action belongs with the other transitions. closed + cancelled are
  // the two terminal states beyond which no action is offered.
  const terminal = status === "closed" || status === "cancelled";

  async function setStatus(next: string, reason?: string) {
    // GAP-CRM-SERVICE-REQUESTS-DETAIL-01: `resolution` means strictly "how the
    // request was fulfilled" and is only sent on resolve. Every other
    // transition's reason (what a pending request is waiting on; closing
    // remarks) goes under `statusNote`, so a Close never overwrites a genuine
    // resolution and a pending request never shows a bogus "Resolution" card.
    const body: Record<string, unknown> = { status: next };
    if (reason) {
      if (next === "resolved") body.resolution = reason;
      else body.statusNote = reason;
    }
    // Send the version we read so the server can reject a stale write (409).
    if (typeof version === "number") body.version = version;
    const res = await fetch(`/api/proxy/v1/crm/service-requests/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // A VERSION_CONFLICT means another officer advanced the request while this
      // one was open — reload so the operator sees the current state, and say so
      // in plain language. Any other failure keeps the catalogued clerk-safe
      // copy and does NOT refresh (preserves UX-016 behaviour).
      const code = await res
        .clone()
        .json()
        .then((b: { error?: { code?: string }; code?: string }) => b?.error?.code ?? b?.code)
        .catch(() => undefined);
      if (res.status === 409 && code === "VERSION_CONFLICT") {
        router.refresh();
        throw new Error(t("conflict"));
      }
      throw new Error(serviceRequestActionError());
    }
    // Resolve / close queue a notice to the citizen. The response says whether one is on its
    // way or there is no phone/email to send to; the delivery RESULT shows later on the page.
    setNotice(undefined);
    if (next === "resolved" || next === "closed") {
      const payload = await res
        .clone()
        .json()
        .then((b: { data?: { notification?: { state?: string; channel?: string | null } } }) => b?.data?.notification)
        .catch(() => undefined);
      if (payload?.state === "no_contact") setNotice(t("noticeNoContact"));
      else if (payload?.state === "queued") {
        setNotice(payload.channel === "sms" || payload.channel === "email" ? t("noticeQueued", { channel: t(`channel_${payload.channel}`) }) : t("noticeQueuedNoChannel"));
      }
    }
    router.refresh();
  }

  const noticeEl = notice ? (
    <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 13, color: "var(--ink2)", maxWidth: 420 }}>{notice}</p>
  ) : null;

  if (terminal) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <span style={{ fontSize: 13, color: "var(--ink2)" }}>
          {t("terminalNote", { status: t(status === "closed" ? "statusClosed" : "statusCancelled") })}
        </span>
        {noticeEl}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {canAssign ? (
        <AssignOfficer id={id} version={version} assignedTo={assignedTo} assignedToName={assignedToName} />
      ) : null}
      {status === "open" && (
        <ActionButton
          label={t("startWork")}
          confirmTitle={t("startWorkTitle")}
          confirmDescription={t("startWorkDescription")}
          onConfirm={() => setStatus("in_progress")}
        />
      )}
      {status !== "pending" && status !== "resolved" && (
        <ActionButton
          label={t("markPending")}
          confirmTitle={t("markPendingTitle")}
          confirmDescription={t("markPendingDescription")}
          requireReason
          reasonLabel={t("markPendingReason")}
          minReasonLength={10}
          onConfirm={(reason) => setStatus("pending", reason)}
        />
      )}
      {status !== "resolved" && (
        <ActionButton
          label={t("resolve")}
          className="primary"
          confirmTitle={t("resolveTitle")}
          confirmDescription={t("resolveDescription")}
          requireReason
          reasonLabel={t("resolveReason")}
          minReasonLength={10}
          onConfirm={(reason) => setStatus("resolved", reason)}
        />
      )}
      {/* GAP-CRM-SERVICE-REQUESTS-DETAIL-06: Close is hidden while the request
          is still 'open' (never worked). It must be started/resolved first, or
          cancelled if withdrawn — a never-worked request should not be "closed".
          A mandatory, ≥10-char closing remark is required to avoid one-character
          sign-offs. */}
      {status !== "open" && (
        <ActionButton
          label={t("close")}
          danger
          confirmTitle={t("closeTitle")}
          confirmDescription={t("closeDescription")}
          requireReason
          reasonLabel={t("closeReason")}
          minReasonLength={10}
          onConfirm={(reason) => setStatus("closed", reason)}
        />
      )}
      {/* GAP-CRM-SERVICE-REQUESTS-DETAIL-05: "cancelled" is a supported terminal
          state (service STATUS enum + closed_at handling), but nothing set it.
          Offer Cancel as a danger action with a mandatory reason; it is distinct
          from Close (request withdrawn/not actionable rather than fulfilled). */}
      <ActionButton
        label={t("cancelRequest")}
        danger
        confirmTitle={t("cancelTitle")}
        confirmDescription={t("cancelDescription")}
        requireReason
        reasonLabel={t("cancelReason")}
        minReasonLength={10}
        onConfirm={(reason) => setStatus("cancelled", reason)}
      />
    </div>
    {noticeEl}
    </div>
  );
}

/**
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-05: assign or reassign the officer responsible for a request.
 * Offered to managers only. The picker lists the tenant's staff by NAME (crm-service's directory)
 * and sends the chosen id with the `version` the page read, so a stale assignment is rejected
 * (409) rather than silently overwriting someone else's. The server re-checks the role, that the
 * officer is an active user of this tenant, and audits the change.
 */
function AssignOfficer({
  id,
  version,
  assignedTo,
  assignedToName,
}: {
  id: string;
  version?: number;
  assignedTo: string | null;
  assignedToName: string | null;
}) {
  const t = useTranslations("crmServiceRequestActions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<EscalationUser[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function openDialog() {
    setError(undefined);
    setChoice("");
    setOpen(true);
    if (users === null) {
      const res = await getEscalationUsers();
      setUsers(res.data);
      setLoadFailed(res.source === "error");
    }
  }

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/crm/service-requests/${id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: choice, ...(typeof version === "number" ? { version } : {}) }),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      const code = await res
        .clone()
        .json()
        .then((b: { error?: { code?: string }; code?: string }) => b?.error?.code ?? b?.code)
        .catch(() => undefined);
      if (res.status === 409 && code === "VERSION_CONFLICT") {
        router.refresh();
        setError(t("conflict"));
      } else if (res.status === 422 && code === "INVALID_ASSIGNEE") {
        setError(t("assignInvalid"));
      } else if (res.status === 503) {
        setError(t("assignUnavailable"));
      } else {
        setError(serviceRequestActionError());
      }
    } catch {
      setError(serviceRequestActionError());
    } finally {
      setBusy(false);
    }
  }

  const choices = (users ?? []).filter((u) => u.id !== assignedTo);

  return (
    <>
      <button type="button" className="btn" onClick={() => void openDialog()}>
        {assignedTo ? t("reassign") : t("assign")}
      </button>
      <Modal
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        closeOnOverlayClick={!busy}
        size="sm"
        title={assignedTo ? t("reassignTitle") : t("assignTitle")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
            {assignedTo
              ? t("reassignDescription", { name: assignedToName ?? t("currentOfficerUnavailable") })
              : t("assignDescription")}
          </p>
          {users === null ? (
            <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 13 }}>{t("assignLoading")}</p>
          ) : loadFailed ? (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>{t("assignDirectoryUnavailable")}</p>
          ) : choices.length === 0 ? (
            <p role="status" style={{ margin: 0, fontSize: 13 }}>{t("assignNoOfficers")}</p>
          ) : (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span>{t("assignOfficer")}</span>
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                style={{ padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
              >
                <option value="">{t("assignSelect")}</option>
                {choices.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          {error ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>{error}</p> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("assignCancel")}</Button>
            <Button type="button" onClick={() => void submit()} disabled={!choice || busy} loading={busy}>
              {busy ? t("assigning") : assignedTo ? t("reassign") : t("assign")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
