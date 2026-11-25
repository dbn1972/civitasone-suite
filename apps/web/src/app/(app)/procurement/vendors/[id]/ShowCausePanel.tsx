"use client";

/**
 * Vendor show-cause lifecycle (issue -> respond -> appeal -> decide).
 *
 * Mirrors procurement-service vendor/scorecard-routes.ts exactly:
 *  - GET  /vendors/:id/show-cause            readers (procurement, audit, finance)
 *  - POST /vendors/:id/show-cause            writers   body { reason }       -> 202
 *  - PATCH /show-cause/:id/respond           writers   body { response }     -> 202
 *  - PATCH /show-cause/:id/appeal            writers   body { appealText }   -> 202
 *  - PATCH /show-cause/:id/decide            procurement_admin / super_admin
 *                                            body { decision, uphold }       -> 202
 * State machine (scorecard-domain.ts): issued -> responded|closed;
 * responded -> appealed|upheld|closed; appealed -> upheld|closed; upheld -> closed.
 * Maker-checker: the decider must differ from the issuer (the consumer rejects
 * otherwise). Upholding only PROPOSES a debarment event; it does not blacklist
 * the vendor, so the copy says so. Every command is async (202).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton } from "@/app/_components/ds";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";

export type ShowCauseStatus = "issued" | "responded" | "appealed" | "upheld" | "closed";

export interface ShowCauseRow {
  id: string;
  status: ShowCauseStatus;
  reason: string;
  issuedBy: string;
  response?: string | null;
  appealText?: string | null;
  decision?: string | null;
  createdAt?: string | null;
}

const PREFIX = "/api/proxy/v1/procurement";

async function call(method: "POST" | "PATCH", path: string, body: unknown): Promise<void> {
  const res = await fetch(`${PREFIX}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await userFacingErrorFromResponse(res, "save", "show-cause notice");
}

export function ShowCausePanel({
  vendorId,
  canWrite,
  canDecide,
  currentUserId,
}: {
  vendorId: string;
  canWrite: boolean;
  canDecide: boolean;
  currentUserId: string | null;
}) {
  const t = useTranslations("procurement.w2.showCause");
  const [rows, setRows] = useState<ShowCauseRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${PREFIX}/vendors/${vendorId}/show-cause`, { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as { data?: ShowCauseRow[] };
      setRows(Array.isArray(json.data) ? json.data : []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [vendorId]);

  useEffect(() => { void load(); }, [load]);

  const accepted = () => { setNote(t("accepted")); void load(); };

  return (
    <section className="card pad" aria-labelledby="show-cause-h" data-testid="show-cause-panel" style={{ marginBlockStart: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 id="show-cause-h" style={{ fontSize: 16, margin: 0 }}>{t("title")}</h2>
        {canWrite ? (
          <ActionButton
            className="btn primary"
            label={t("issue")}
            confirmTitle={t("issueTitle")}
            confirmDescription={t("issueBody")}
            confirmLabel={t("issue")}
            requireReason
            minReasonLength={3}
            maxReasonLength={2000}
            reasonLabel={t("issueReason")}
            onConfirm={(reason) => call("POST", `/vendors/${vendorId}/show-cause`, { reason: (reason ?? "").trim() })}
            onSuccess={accepted}
          />
        ) : null}
      </div>
      {note ? <p role="status" style={{ fontSize: 12 }}>{note}</p> : null}

      {failed ? (
        <div role="alert" style={{ marginBlockStart: 8 }}>
          <p style={{ margin: 0 }}>{t("loadFailed")}</p>
          <button type="button" className="btn ghost" onClick={() => { setRows(null); void load(); }}>{t("retry")}</button>
        </div>
      ) : rows === null ? (
        <p className="muted" role="status">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 12 }}>
          {rows.map((r) => (
            <ShowCauseItem key={r.id} row={r} canWrite={canWrite} canDecide={canDecide} currentUserId={currentUserId} onDone={accepted} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ShowCauseItem({
  row, canWrite, canDecide, currentUserId, onDone,
}: { row: ShowCauseRow; canWrite: boolean; canDecide: boolean; currentUserId: string | null; onDone: () => void }) {
  const t = useTranslations("procurement.w2.showCause");
  const s = row.status;
  const isIssuer = currentUserId !== null && currentUserId === row.issuedBy;
  const decideOpen = canDecide && s !== "closed";
  const canUphold = s === "responded" || s === "appealed";
  const trim = (v?: string) => (v ?? "").trim();

  return (
    <li className="card pad" style={{ borderInlineStart: "4px solid var(--line)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`pill ${s === "upheld" ? "bad" : s === "closed" ? "" : "warn"}`}>{t(`status.${s}`)}</span>
        {row.createdAt ? <span className="muted" style={{ fontSize: 12 }}>{new Date(row.createdAt).toLocaleDateString("en-IN")}</span> : null}
      </div>
      <dl style={{ margin: "8px 0" }}>
        <dt className="label">{t("reason")}</dt><dd style={{ margin: 0 }}>{row.reason}</dd>
        {row.response ? (<><dt className="label">{t("response")}</dt><dd style={{ margin: 0 }}>{row.response}</dd></>) : null}
        {row.appealText ? (<><dt className="label">{t("appeal")}</dt><dd style={{ margin: 0 }}>{row.appealText}</dd></>) : null}
        {row.decision ? (<><dt className="label">{t("decision")}</dt><dd style={{ margin: 0 }}>{row.decision}</dd></>) : null}
      </dl>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canWrite && s === "issued" ? (
          <ActionButton
            className="btn ghost" label={t("respond")} confirmTitle={t("respondTitle")} confirmDescription={t("respondBody")}
            confirmLabel={t("respond")} requireReason minReasonLength={1} maxReasonLength={2000} reasonLabel={t("responseLabel")}
            onConfirm={(v) => call("PATCH", `/show-cause/${row.id}/respond`, { response: trim(v) })} onSuccess={onDone}
          />
        ) : null}
        {canWrite && s === "responded" ? (
          <ActionButton
            className="btn ghost" label={t("fileAppeal")} confirmTitle={t("appealTitle")} confirmDescription={t("appealBody")}
            confirmLabel={t("fileAppeal")} requireReason minReasonLength={1} maxReasonLength={2000} reasonLabel={t("appealLabel")}
            onConfirm={(v) => call("PATCH", `/show-cause/${row.id}/appeal`, { appealText: trim(v) })} onSuccess={onDone}
          />
        ) : null}
        {decideOpen && !isIssuer && canUphold ? (
          <ActionButton
            danger label={t("uphold")} confirmTitle={t("upholdTitle")} confirmDescription={t("upholdBody")}
            confirmLabel={t("uphold")} requireReason minReasonLength={1} maxReasonLength={2000} reasonLabel={t("decisionLabel")}
            onConfirm={(v) => call("PATCH", `/show-cause/${row.id}/decide`, { decision: trim(v), uphold: true })} onSuccess={onDone}
          />
        ) : null}
        {decideOpen && !isIssuer ? (
          <ActionButton
            className="btn ghost" label={t("close")} confirmTitle={t("closeTitle")} confirmDescription={t("closeBody")}
            confirmLabel={t("close")} requireReason minReasonLength={1} maxReasonLength={2000} reasonLabel={t("decisionLabel")}
            onConfirm={(v) => call("PATCH", `/show-cause/${row.id}/decide`, { decision: trim(v), uphold: false })} onSuccess={onDone}
          />
        ) : null}
      </div>
      {decideOpen && isIssuer ? <p className="muted" style={{ fontSize: 12 }}>{t("sodNote")}</p> : null}
    </li>
  );
}

