"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";

/**
 * Plain-language failure message for a failed grievance lifecycle action.
 * `patch` is a plain async helper, not a component or hook, so it can't call
 * the useFormError hook; toHumanError is the same catalogued-message
 * building block that hook is built on -- never the backend's own
 * message/error text or the raw HTTP status. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 *
 * GAP-CRM-GRIEVANCES-DETAIL-03: the message is now chosen from the HTTP status
 * so a permission refusal (403) and a business-rule conflict (409, e.g.
 * "already disposed") no longer read as the same transient "couldn't save"
 * error. The status is read ONLY to pick a catalogued kind — it is never echoed
 * to the clerk (UX-020), and the backend's own text is never shown. A 412
 * version-conflict stays its own dedicated path (grievanceConflictError) and is
 * handled before this function is reached.
 */
function grievanceActionError(status?: number): string {
  const kind = status === 403 ? "forbidden" : status === 409 ? "conflict" : "save";
  const human = toHumanError(kind, { area: "grievance" });
  return `${human.what} ${human.next}`;
}

/**
 * Grievance lifecycle actions — CPGRAMS-aligned.
 *
 * Status vocabulary (post-0082 migration):
 *   REGISTERED  initial
 *   FORWARDED   assigned to department
 *   ATTENDED    being worked on
 *   DISPOSED    resolved or administratively closed (terminal)
 *   APPEAL      citizen first appeal (urgent priority)
 *
 * Available actions:
 *   Forward      PATCH /forward       { forwardedTo }   FORWARDED
 *   First Appeal PATCH /first-appeal  { appealReason }  APPEAL
 *   Resolve      PATCH /resolve       { resolution }    DISPOSED
 *   Close        PATCH /close         (admin only)      DISPOSED
 *
 * The legacy /escalate alias remains on the backend for backward compatibility.
 * The UI uses /first-appeal to match CPGRAMS portal terminology.
 */
export function GrievanceActions({ id, status, version, canClose = false }: { id: string; status: string; version?: number; canClose?: boolean }) {
  const t = useTranslations("crmGrievanceActions");
  const router = useRouter();

  // DISPOSED is the only terminal state in CPGRAMS (covers both resolved + closed)
  const terminal = status === "DISPOSED";
  const disposed = status === "DISPOSED";

  async function patch(action: string, payload?: Record<string, unknown>) {
    const res = await fetch(`/api/proxy/v1/crm/grievances/${id}/${action}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        // GAP-CRM-GRIEVANCES-DETAIL-01: optimistic-concurrency guard. Two clerks
        // acting on the same grievance used to silently overwrite each other —
        // no version was ever sent. We send the version we rendered as If-Match
        // so the server can reject a stale write with 412. Harmless if the
        // backend doesn't yet enforce it (the header is simply ignored).
        ...(version !== undefined ? { "If-Match": String(version) } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (res.status === 412) {
      // Pull the page back in line with the server before surfacing the
      // conflict, so the clerk retries against the latest version.
      router.refresh();
      throw new Error(t("conflict"));
    }
    if (!res.ok) {
      // GAP-CRM-GRIEVANCES-DETAIL-03: a 409 means the grievance moved under us
      // (e.g. already disposed), so refresh the page to show its real state;
      // a 403/5xx leaves the page as-is. The status only picks the catalogued
      // message — it is never shown to the clerk.
      if (res.status === 409) router.refresh();
      throw new Error(grievanceActionError(res.status));
    }
    router.refresh();
  }

  if (terminal) {
    return (
      <span style={{ fontSize: 13, color: "var(--ink2)" }}>
        {t("disposedNote")}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {/* Forward to department — CPGRAMS portal: forward to competent authority */}
      <ActionButton
        label={t("forward")}
        confirmTitle={t("forwardTitle")}
        confirmDescription={t("forwardDescription")}
        requireReason
        reasonLabel={t("forwardReasonLabel")}
        onConfirm={(dept) => patch("forward", { forwardedTo: dept })}
      />

      {/* First Appeal — citizen-initiated; bumps priority to urgent */}
      <ActionButton
        label={t("firstAppeal")}
        confirmTitle={t("firstAppealTitle")}
        confirmDescription={t("firstAppealDescription")}
        requireReason
        reasonLabel={t("firstAppealReasonLabel")}
        onConfirm={(reason) => patch("first-appeal", { ...(reason ? { appealReason: reason } : {}) })}
      />

      {!disposed && (
        <ActionButton
          label={t("resolve")}
          className="primary"
          confirmTitle={t("resolveTitle")}
          confirmDescription={t("resolveDescription")}
          requireReason
          reasonLabel={t("resolveReasonLabel")}
          onConfirm={(reason) => patch("resolve", { resolution: reason })}
        />
      )}

      {/* GAP-CRM-GRIEVANCES-DETAIL-02: Close is an administrator-only action
          (crm-service 403s a plain crm_user). Only offer it when the server
          page computed canClose from the session roles — a non-admin used to
          see Close, confirm the dialog, then get the generic "couldn't save"
          message. The server remains the real gate. */}
      {canClose && (
        <ActionButton
          label={t("close")}
          danger
          confirmTitle={t("closeTitle")}
          confirmDescription={t("closeDescription")}
          onConfirm={() => patch("close")}
        />
      )}
    </div>
  );
}
