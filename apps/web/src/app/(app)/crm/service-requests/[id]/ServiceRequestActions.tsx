"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";

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
}: {
  id: string;
  status: string;
  version?: number;
}) {
  const t = useTranslations("crmServiceRequestActions");
  const router = useRouter();

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
    router.refresh();
  }

  if (terminal) {
    return (
      <span style={{ fontSize: 13, color: "var(--ink2)" }}>
        {t("terminalNote", { status: t(status === "closed" ? "statusClosed" : "statusCancelled") })}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
          onConfirm={(reason) => setStatus("resolved", reason)}
        />
      )}
      <ActionButton
        label={t("close")}
        danger
        confirmTitle={t("closeTitle")}
        confirmDescription={t("closeDescription")}
        requireReason
        reasonLabel={t("closeReason")}
        onConfirm={(reason) => setStatus("closed", reason)}
      />
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
        onConfirm={(reason) => setStatus("cancelled", reason)}
      />
    </div>
  );
}
