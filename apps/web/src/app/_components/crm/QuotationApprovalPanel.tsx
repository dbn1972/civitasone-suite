"use client";
/**
 * QuotationApprovalPanel — QP-004. Request and decide approvals for a
 * quotation's discounts / deviations. The parent QuotationBuilder blocks the
 * Send/Finalize action while any approval is unapproved (the backend enforces
 * this with 422 APPROVAL_REQUIRED, surfaced honestly — never a fake send). A
 * failed load shows the saved-info badge rather than an empty "all approved".
 *
 * Maker-checker (GAP-CRM-QUOTATIONS-01): Approve/Reject are only offered when
 * the user holds a quotation-approve role (`canApprove`, from the verified
 * session) AND is not the requester of that row (`requestedBy !== currentUserId`).
 * The server (quotation-approval-routes.ts decide) remains the authority on
 * role; the UI merely stops offering a control that would 403 or that would let
 * a requester self-approve. Reject requires a reason (ConfirmDialog).
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import { formatBps } from "@/lib/formatters";
import { percentToBps } from "@/lib/money";
import {
  getApprovals,
  requestApproval,
  approveApproval,
  rejectApproval,
  APPROVAL_TYPES,
  APPROVAL_TYPE_LABELS,
  type ApprovalRequest,
  type ApprovalType,
  type QpSource,
} from "@/lib/crm/quotation";

interface QuotationApprovalPanelProps {
  quotationId: string;
  /** Notifies the parent whether a blocking (unapproved) approval exists. */
  onBlockingChange?: (blocking: boolean) => void;
  /**
   * Whether the signed-in user may decide approvals (holds a
   * quotation-approve role, from the verified session). The server stays the
   * authority; this only decides whether Approve/Reject are offered.
   */
  canApprove?: boolean;
  /** Signed-in user id, for the maker-checker self-approval hide. */
  currentUserId?: string | null;
}

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

function isApproved(a: ApprovalRequest): boolean {
  return a.status.toLowerCase() === "approved";
}

function isRejected(a: ApprovalRequest): boolean {
  const s = a.status.toLowerCase();
  return s === "rejected" || s === "denied";
}

/** A row still awaiting a decision (not approved and not rejected). */
function isPending(a: ApprovalRequest): boolean {
  return !isApproved(a) && !isRejected(a);
}

export function QuotationApprovalPanel({
  quotationId,
  onBlockingChange,
  canApprove = false,
  currentUserId = null,
}: QuotationApprovalPanelProps) {
  const t = useTranslations("crmQuotationApprovalPanel");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [source, setSource] = useState<QpSource | "loading">("loading");
  const [type, setType] = useState<ApprovalType>("discount");
  const [percent, setPercent] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("quotation approval");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getApprovals(quotationId);
    if (!isLive()) return;
    setApprovals(data);
    setSource(s);
    onBlockingChange?.(data.some((a) => isPending(a)));
  }
  // Reload whenever the quotation changes. onBlockingChange is a stable setState
  // reference from the parent, so it is safe to include in the dependency list.
  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is redefined each render but only closes over values already listed in this array; nothing else it reads can change independently.
  }, [quotationId, onBlockingChange]);

  async function submitRequest() {
    setMessage("");
    setError("");
    if (reason.trim().length === 0) {
      setError("A reason is required to request an approval.");
      return;
    }
    let amountBps: number | undefined;
    if (type === "discount") {
      const bps = percentToBps(percent);
      if (bps === null || bps <= 0) {
        setError("Enter the discount as a positive percentage (max 2 decimals).");
        return;
      }
      amountBps = bps;
    }
    setBusy(true);
    try {
      await requestApproval(quotationId, { type, reason: reason.trim(), amountBps });
      setMessage("Approval requested.");
      setReason("");
      setPercent("");
      await load();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  async function grant(a: ApprovalRequest) {
    if (!a.id) return;
    setBusy(true);
    setError("");
    try {
      await approveApproval(quotationId, a.id);
      setMessage("Approval granted.");
      await load();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  async function doReject(approvalId: string, rejectReason?: string) {
    setBusy(true);
    setError("");
    try {
      await rejectApproval(approvalId, rejectReason);
      setMessage(t("rejected"));
      await load();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  /** May the current user decide THIS row? Approve-role AND not the requester. */
  function canDecide(a: ApprovalRequest): boolean {
    if (!canApprove) return false;
    // Maker-checker: never let the requester decide their own request. Only
    // enforced when the API returns a requester and we know who is signed in;
    // the server remains the ultimate authority (see panel header).
    if (a.requestedBy && currentUserId && a.requestedBy === currentUserId) return false;
    return true;
  }

  const blocking = approvals.some((a) => isPending(a));

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Discount / deviation approvals</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>

      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>
          {error}
        </p>
      ) : null}

      {source === "loading" ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
          Loading approvals…
        </p>
      ) : approvals.length === 0 ? (
        <EmptyState icon="🔏" title="No approvals requested" message="Request an approval for any discount or deviation before sending." />
      ) : (
        <>
          {blocking ? (
            <p role="status" style={{ fontSize: 13, color: "#b42318", padding: "0 12px", fontWeight: 600 }}>
              Sending is blocked until every approval is granted.
            </p>
          ) : approvals.some((a) => isRejected(a)) ? (
            <p role="status" style={{ fontSize: 13, color: "#b45309", padding: "0 12px" }}>
              {t("rejectedNotice")}
            </p>
          ) : (
            <p role="status" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>
              All approvals granted — this quotation can be sent.
            </p>
          )}
          <table className="tbl" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((a) => {
                const pending = isPending(a);
                const decidable = pending && canDecide(a);
                const mine = Boolean(a.requestedBy && currentUserId && a.requestedBy === currentUserId);
                return (
                  <tr key={a.id ?? `${a.type}-${a.reason}`}>
                    <td>{APPROVAL_TYPE_LABELS[a.type]}</td>
                    <td>{a.amountBps !== undefined ? formatBps(a.amountBps) : "—"}</td>
                    <td>{a.reason}</td>
                    <td>
                      {isApproved(a) ? (
                        <span style={{ color: "#047857" }}>Approved</span>
                      ) : isRejected(a) ? (
                        <span style={{ color: "#b42318", fontWeight: 600 }}>{t("statusRejected")}</span>
                      ) : (
                        <span style={{ color: "#b45309" }}>{a.status || t("statusPending")}</span>
                      )}
                    </td>
                    <td>
                      {pending ? (
                        decidable ? (
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            <Button type="button" size="sm" onClick={() => void grant(a)} disabled={busy}>
                              {t("approve")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() => { if (a.id) setRejectId(a.id); }}
                              disabled={busy || !a.id}
                            >
                              {t("reject")}
                            </Button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            {mine ? t("awaitingOther") : t("awaitingApprover")}
                          </span>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, margin: 12 }}>
        <legend style={{ fontSize: 13, fontWeight: 600 }}>Request an approval</legend>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          The actual discount is server-computed from the line prices at send time; the figure below is advisory
          context for the approver. The send block is enforced by the backend.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "160px 140px 1fr auto", gap: 8, alignItems: "end" }}>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Type
            <select aria-label="Approval type" value={type} onChange={(e) => setType(e.target.value as ApprovalType)} style={inputStyle}>
              {APPROVAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {APPROVAL_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Discount % (advisory)
            <input aria-label="Discount percent" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} style={inputStyle} disabled={type !== "discount"} placeholder={type === "discount" ? "10" : "n/a"} />
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Reason
            <input aria-label="Approval reason" value={reason} aria-invalid={reason.trim() ? undefined : true} onChange={(e) => setReason(e.target.value)} style={inputStyle} placeholder="Strategic account, board-approved" />
          </label>
          <Button type="button" onClick={() => void submitRequest()} disabled={busy}>
            {busy ? "…" : "Request"}
          </Button>
        </div>
      </fieldset>

      <ConfirmDialog
        open={rejectId !== null}
        danger
        requireReason
        reasonLabel={t("rejectReasonLabel")}
        title={t("rejectTitle")}
        description={t("rejectDescription")}
        confirmLabel={t("rejectConfirm")}
        busy={busy}
        onCancel={() => setRejectId(null)}
        onConfirm={(rejectReason) => {
          const id = rejectId;
          setRejectId(null);
          if (id) void doReject(id, rejectReason);
        }}
      />
    </div>
  );
}
