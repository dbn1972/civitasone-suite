"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, ErrorState, SkeletonRow } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { glErrorKey } from "../glStatus";
import { HEAD_FIELDS, headsPatch, parseAssetSettings, type AssetSettings, type HeadField } from "./settingsModel";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const EMPTY: Record<HeadField, string> = { cwipAccountCode: "", fixedAssetAccountCode: "", impairmentExpenseAccountCode: "", revaluationReserveAccountCode: "", rouAccountCode: "", leaseLiabilityAccountCode: "", leaseOffsetAccountCode: "" };

export function SettingsPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations("assetsGl");
  const [settings, setSettings] = useState<AssetSettings | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ok">("loading");
  const [edited, setEdited] = useState(EMPTY);
  const [reason, setReason] = useState("");
  const [offReason, setOffReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const res = await browserFetch("v1/asset/settings", { signal });
      const parsed = res.ok ? parseAssetSettings(await res.json().catch(() => null)) : null;
      if (!parsed) { setState("error"); return; }
      setSettings(parsed);
      setEdited({
        cwipAccountCode: parsed.heads.cwipAccountCode ?? "", fixedAssetAccountCode: parsed.heads.fixedAssetAccountCode ?? "", impairmentExpenseAccountCode: parsed.heads.impairmentExpenseAccountCode ?? "", revaluationReserveAccountCode: parsed.heads.revaluationReserveAccountCode ?? "", rouAccountCode: parsed.heads.rouAccountCode ?? "",
        leaseLiabilityAccountCode: parsed.heads.leaseLiabilityAccountCode ?? "", leaseOffsetAccountCode: parsed.heads.leaseOffsetAccountCode ?? "",
      });
      setState("ok");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setState("error");
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  async function send(path: string, method: "PATCH" | "POST", body: unknown, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await browserFetch(path, { method, body: JSON.stringify(body) });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        const gl = glErrorKey(code);
        setMessage({ tone: "bad", text: gl ? t(gl) : code === "MAKER_CHECKER" ? t("makerChecker") : await errorMessageFromResponse(res, "save", "asset settings") });
        return;
      }
      setMessage({ tone: "good", text: ok });
      setReason(""); setOffReason(""); setRejectReason("");
      await load();
    } catch {
      setMessage({ tone: "bad", text: toHumanError("save", { area: "asset settings" }).what });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div aria-busy="true" aria-label="Loading settings">{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>;
  if (state === "error" || !settings) return <ErrorState error={toHumanError("load", { area: "asset settings" })} onRetry={() => void load()} />;

  const change = headsPatch(settings.heads, edited);
  const patchReady = change !== null && change.invalid === null && reason.trim().length >= 3;

  return (
    <>
      {message ? (
        <div role={message.tone === "bad" ? "alert" : "status"} className={`pill ${message.tone}`} style={{ display: "block", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13, whiteSpace: "normal" }}>{message.text}</div>
      ) : null}
      <Card title={t("glSection")} padding>
        <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 0 }}>{t("glHelp")}</p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {HEAD_FIELDS.map(({ field, labelKey }) => (
            <div key={field} style={{ display: "grid", gap: 4 }}>
              <label className="l" htmlFor={`gl-${field}`}>{t(labelKey)}</label>
              <input
                id={`gl-${field}`} value={edited[field]} disabled={!canManage} placeholder={t("notSet")} maxLength={16}
                aria-invalid={change?.invalid === field || undefined}
                onChange={(e) => setEdited({ ...edited, [field]: e.target.value })} style={inputStyle}
              />
            </div>
          ))}
        </div>
        {canManage ? (
          <div style={{ marginTop: 12, display: "grid", gap: 8, maxWidth: 420 }}>
            <label className="l" htmlFor="gl-reason">{t("reasonLabel")}</label>
            <input id="gl-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} style={inputStyle} />
            <Button type="button" disabled={busy || !patchReady} onClick={() => change && void send("v1/asset/settings", "PATCH", { ...change.patch, reason: reason.trim() }, t("saved"))}>
              {t("save")}
            </Button>
          </div>
        ) : null}
      </Card>

      <div style={{ height: 16 }} />
      <Card title={t("approvalSection")} padding>
        <p style={{ marginTop: 0 }}>{settings.capitalizeMakerChecker ? t("approvalOn") : t("approvalOff")}</p>
        {settings.pending ? (
          <p role="status" style={{ color: "var(--warn)", fontSize: 13 }}>{settings.pending.requestedByMe ? t("pendingOffMine") : t("pendingOff")}</p>
        ) : null}
        {canManage ? (
          settings.capitalizeMakerChecker ? (
            settings.pending ? (
              !settings.pending.requestedByMe ? (
                <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                  <Button type="button" disabled={busy} onClick={() => void send(`v1/asset/settings/requests/${settings.pending!.id}/approve`, "POST", {}, t("decided"))}>{t("approve")}</Button>
                  <label className="l" htmlFor="gl-reject-reason">{t("rejectReason")}</label>
                  <input id="gl-reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} maxLength={500} style={inputStyle} />
                  <Button type="button" variant="ghost" disabled={busy || rejectReason.trim().length < 3} onClick={() => void send(`v1/asset/settings/requests/${settings.pending!.id}/reject`, "POST", { reason: rejectReason.trim() }, t("decided"))}>{t("reject")}</Button>
                </div>
              ) : null
            ) : (
              <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{t("requestOffHelp")}</p>
                <label className="l" htmlFor="gl-off-reason">{t("reasonLabel")}</label>
                <input id="gl-off-reason" value={offReason} onChange={(e) => setOffReason(e.target.value)} maxLength={500} style={inputStyle} />
                <Button type="button" variant="ghost" disabled={busy || offReason.trim().length < 3} onClick={() => void send("v1/asset/settings", "PATCH", { capitalizeMakerChecker: false, reason: offReason.trim() }, t("requestSubmitted"))}>{t("requestOff")}</Button>
              </div>
            )
          ) : (
            <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
              <label className="l" htmlFor="gl-on-reason">{t("reasonLabel")}</label>
              <input id="gl-on-reason" value={offReason} onChange={(e) => setOffReason(e.target.value)} maxLength={500} style={inputStyle} />
              <Button type="button" disabled={busy || offReason.trim().length < 3} onClick={() => void send("v1/asset/settings", "PATCH", { capitalizeMakerChecker: true, reason: offReason.trim() }, t("switchedOn"))}>{t("switchOn")}</Button>
            </div>
          )
        ) : null}
      </Card>
    </>
  );
}
