"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import {
  canCancel, canDecide, decideOperatorRequest, loadPendingRequests, type OperatorDecision, type OperatorRequest,
} from "@/lib/admin/operatorActions";

type View =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; requests: OperatorRequest[] };

/**
 * GAP-ADMIN-OPERATORS-05: pending operator changes. A super admin other than the requester approves or
 * rejects; the requester can cancel. Loading, failed and empty are three different screens.
 */
export function OperatorRequestsPanel({
  viewerId, viewerRoles, tick,
}: { viewerId: string | null; viewerRoles: readonly string[]; tick: number }) {
  const t = useTranslations("adminOperators");
  const fmt = useFormatter();
  const router = useRouter();
  const [view, setView] = useState<View>({ state: "loading" });
  const [acting, setActing] = useState<{ req: OperatorRequest; decision: OperatorDecision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await loadPendingRequests();
    setView(r.ok ? { state: "ready", requests: r.requests } : { state: "error" });
  }, []);

  useEffect(() => { setView({ state: "loading" }); void load(); }, [load, tick]);

  async function confirm(note: string | undefined) {
    if (!acting) return;
    setBusy(true);
    setError(undefined);
    const r = await decideOperatorRequest(acting.req.id, acting.decision, note);
    setBusy(false);
    if (!r.ok) { setError(t(`error.${r.code}`)); return; }
    setNotice(acting.decision === "cancel" ? t("cancelled") : t("decided"));
    setActing(null);
    // The change is applied by a worker moments after the 202: refresh the list and the directory a little later.
    window.setTimeout(() => { void load(); router.refresh(); }, 1200);
  }

  const kindLabel = (k: string) => (k === "suspend" || k === "reactivate" || k === "role_change" || k === "grant" ? t(`kind.${k}`) : t("kind.unknown"));
  const roleName = (r: string | null) => (r === "super_admin" || r === "platform_admin" ? t(`role.${r}`) : t("role.unknown"));

  return (
    <Card title={t("title")}>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--mut)" }}>{t("subtitle")}</p>
      {notice && <p role="status" style={{ margin: "0 0 10px", fontSize: 13 }}>{notice}</p>}
      {view.state === "loading" && <p role="status" aria-busy="true">{t("loading")}</p>}
      {view.state === "error" && (
        <div role="alert">
          <p style={{ margin: "0 0 8px" }}>{t("loadFailed")}</p>
          <Button size="sm" onClick={() => { setView({ state: "loading" }); void load(); }}>{t("retry")}</Button>
        </div>
      )}
      {view.state === "ready" && view.requests.length === 0 && <p>{t("empty")}</p>}
      {view.state === "ready" && view.requests.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {view.requests.map((r) => {
            const decide = canDecide(r, viewerId, viewerRoles);
            const mine = canCancel(r, viewerId);
            return (
              <li key={r.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <strong>
                  {r.kind === "role_change"
                    ? t("summaryRole", { who: r.requestedByName, name: r.targetName, from: roleName(r.fromRole), to: roleName(r.toRole) })
                    : r.kind === "grant"
                    ? t("summaryGrant", { who: r.requestedByName, name: r.targetName, to: roleName(r.toRole) })
                    : t("summary", { who: r.requestedByName, kind: kindLabel(r.kind).toLowerCase(), name: r.targetName })}
                </strong>
                <div style={{ fontSize: 12.5, color: "var(--mut)" }}>
                  {r.requestedAt ? t("requestedOn", { when: fmt.dateTime(new Date(r.requestedAt), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) }) : null}
                </div>
                <div style={{ fontSize: 13 }}>{t("reasonShown", { reason: r.reason })}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                  {decide && (
                    <>
                      <Button size="sm" aria-label={`${t("approve")}: ${r.targetName}`} onClick={() => { setError(undefined); setActing({ req: r, decision: "approve" }); }}>{t("approve")}</Button>
                      <Button size="sm" variant="ghost" aria-label={`${t("reject")}: ${r.targetName}`} onClick={() => { setError(undefined); setActing({ req: r, decision: "reject" }); }}>{t("reject")}</Button>
                    </>
                  )}
                  {mine && (
                    <Button size="sm" variant="ghost" aria-label={t("cancelAria", { name: r.targetName })} onClick={() => { setError(undefined); setActing({ req: r, decision: "cancel" }); }}>{t("cancel")}</Button>
                  )}
                  {!decide && !mine && <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{t("notYours")}</span>}
                  {mine && !decide && <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{t("waitingOther")}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={acting !== null}
        danger={acting?.decision === "reject"}
        requireReason={acting?.decision === "reject"}
        optionalReason={acting?.decision === "approve"}
        minReasonLength={3}
        maxReasonLength={500}
        reasonLabel={acting?.decision === "reject" ? t("rejectReason") : t("approveNote")}
        title={acting ? (acting.decision === "approve" ? t("approveTitle") : acting.decision === "reject" ? t("rejectTitle") : t("cancelTitle")) : ""}
        description={acting
          ? (acting.decision === "approve"
            ? t("approveDescription", { who: acting.req.requestedByName, kind: kindLabel(acting.req.kind).toLowerCase(), name: acting.req.targetName })
            : acting.decision === "reject" ? t("rejectDescription", { name: acting.req.targetName }) : t("cancelDescription", { name: acting.req.targetName }))
          : ""}
        confirmLabel={acting ? (acting.decision === "approve" ? t("approve") : acting.decision === "reject" ? t("reject") : t("cancelConfirm")) : ""}
        cancelLabel={acting?.decision === "cancel" ? t("keepRequest") : undefined}
        busy={busy}
        errorMessage={error}
        onConfirm={(note) => void confirm(note)}
        onCancel={() => { if (!busy) setActing(null); }}
      />
    </Card>
  );
}
