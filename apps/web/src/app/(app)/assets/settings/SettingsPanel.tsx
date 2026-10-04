"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, ErrorState, SkeletonRow } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { glErrorKey } from "../glStatus";
import { HEAD_FIELDS, KIND_LABEL_KEY, headsPatch, parseAssetSettings, type AssetSettings, type GlArea, type HeadField, type PendingRequest } from "./settingsModel";

const AREA_KEYS: ReadonlyArray<{ area: GlArea; key: "areaAcquisition" | "areaGrn" | "areaMaintenance" | "areaCapitalisation" | "areaLeases" | "areaImpairment" | "areaRevaluation" }> = [
  { area: "acquisition", key: "areaAcquisition" }, { area: "grn", key: "areaGrn" }, { area: "maintenance", key: "areaMaintenance" },
  { area: "capitalisation", key: "areaCapitalisation" }, { area: "leases", key: "areaLeases" },
  { area: "impairment", key: "areaImpairment" }, { area: "revaluation", key: "areaRevaluation" },
];

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const EMPTY = Object.fromEntries(HEAD_FIELDS.map((f) => [f.field, ""])) as Record<HeadField, string>;

/** `canManageCapitalisation`: the capitalisation control is narrower than the GL settings (no finance_admin); defaults to `canManage`. */
export function SettingsPanel({ canManage, canManageCapitalisation = canManage }: { canManage: boolean; canManageCapitalisation?: boolean }) {
  const t = useTranslations("assetsGl");
  const [settings, setSettings] = useState<AssetSettings | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ok">("loading");
  const [edited, setEdited] = useState(EMPTY);
  const [reason, setReason] = useState("");
  const [offReason, setOffReason] = useState("");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [glOffReason, setGlOffReason] = useState("");
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const res = await browserFetch("v1/asset/settings", { signal });
      const parsed = res.ok ? parseAssetSettings(await res.json().catch(() => null)) : null;
      if (!parsed) { setState("error"); return; }
      setSettings(parsed);
      setEdited(Object.fromEntries(HEAD_FIELDS.map((f) => [f.field, parsed.heads[f.field] ?? ""])) as Record<HeadField, string>);
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

  async function send(path: string, method: "PATCH" | "POST", body: unknown, ok: string, after?: (res: Response) => Promise<string | null>) {
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
      const extra = after ? await after(res) : null;
      setMessage({ tone: "good", text: extra ? `${ok} ${extra}` : ok });
      setReason(""); setOffReason(""); setGlOffReason(""); setRejectReasons({});
      await load();
    } catch {
      setMessage({ tone: "bad", text: toHumanError("save", { area: "asset settings" }).what });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div aria-busy="true" aria-label="Loading settings">{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>;
  if (state === "error" || !settings) return <ErrorState error={toHumanError("load", { area: "asset settings" })} onRetry={() => void load()} />;

  const open = settings.glOpen.assetsAwaiting + settings.glOpen.assetsFailed + settings.glOpen.workOrdersAwaiting + settings.glOpen.workOrdersFailed;
  const change = headsPatch(settings.heads, edited);
  const patchReady = change !== null && change.invalid === null && reason.trim().length >= 3;

  return (
    <>
      {message ? (
        <div role={message.tone === "bad" ? "alert" : "status"} className={`pill ${message.tone}`} style={{ display: "block", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13, whiteSpace: "normal" }}>{message.text}</div>
      ) : null}
      <Card title={t("accountingSection")} padding>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {AREA_KEYS.map(({ area, key }) => {
            const a = settings.accounting[area];
            if (!a) return null;
            return (
              <li key={area} style={{ marginBottom: 4 }}>
                {t(key)}{" "}
                {a.configured
                  ? <span className="pill good">{t("areaConfigured")}</span>
                  : <span className="pill warn">{t("accountingNotSetUp")}</span>}
                {!a.configured && a.missing.length > 0 ? <span style={{ color: "var(--ink2)" }}> — {a.missing.map((k) => t(KIND_LABEL_KEY[k])).join(", ")}</span> : null}
              </li>
            );
          })}
        </ul>
        {open > 0 ? (
          <p role="status" style={{ fontSize: 13, color: "var(--warn)", marginBottom: 0 }}>
            {t("openJournals", { awaiting: settings.glOpen.assetsAwaiting + settings.glOpen.workOrdersAwaiting, failed: settings.glOpen.assetsFailed + settings.glOpen.workOrdersFailed })}
          </p>
        ) : null}
        {canManage && open > 0 ? (
          <div style={{ marginTop: 10 }}>
            <Button type="button" disabled={busy} onClick={() => void send("v1/asset/settings/post-pending", "POST", {}, t("postPendingDone"), async (res) => {
              // the server bounds each run; when more are waiting the screen says so instead of implying all were sent
              const body = (await res.clone().json().catch(() => null)) as { more?: unknown; waiting?: unknown; limit?: unknown } | null;
              const waiting = typeof body?.waiting === "number" ? body.waiting : 0;
              const limit = typeof body?.limit === "number" ? body.limit : settings.sweepLimit;
              return body?.more === true ? t("postPendingMore", { count: Math.max(1, waiting - limit) }) : null;
            })}>{t("postPending")}</Button>
          </div>
        ) : null}
      </Card>

      <div style={{ height: 16 }} />
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
            <Button type="button" disabled={busy || !patchReady} onClick={() => change && void send("v1/asset/settings", "PATCH", { ...change.patch, reason: reason.trim() }, settings.glMakerChecker ? t("glRequestSubmitted") : t("saved"))}>
              {settings.glMakerChecker ? t("saveForApproval") : t("save")}
            </Button>
          </div>
        ) : null}
      </Card>

      {settings.pendingRequests.length > 0 ? (
        <>
          <div style={{ height: 16 }} />
          <Card title={t("pendingSection")} padding>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 16 }}>
              {settings.pendingRequests.map((r) => renderPending(r))}
            </ul>
          </Card>
        </>
      ) : null}

      <div style={{ height: 16 }} />
      <Card title={t("glMcSection")} padding>
        <p style={{ marginTop: 0 }}>{settings.glMakerChecker ? t("glMcOn") : t("glMcOff")}</p>
        {canManage ? (
          settings.glMakerChecker ? (
            settings.pendingRequests.some((r) => r.kind === "gl_maker_checker_off") ? null : (
              <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{t("glMcRequestOffHelp")}</p>
                <label className="l" htmlFor="gl-mc-off-reason">{t("reasonLabel")}</label>
                <input id="gl-mc-off-reason" value={glOffReason} onChange={(e) => setGlOffReason(e.target.value)} maxLength={500} style={inputStyle} />
                <Button type="button" variant="ghost" disabled={busy || glOffReason.trim().length < 3} onClick={() => void send("v1/asset/settings", "PATCH", { glMakerChecker: false, reason: glOffReason.trim() }, t("requestSubmitted"))}>{t("glMcRequestOff")}</Button>
              </div>
            )
          ) : (
            <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
              <label className="l" htmlFor="gl-mc-on-reason">{t("reasonLabel")}</label>
              <input id="gl-mc-on-reason" value={glOffReason} onChange={(e) => setGlOffReason(e.target.value)} maxLength={500} style={inputStyle} />
              <Button type="button" disabled={busy || glOffReason.trim().length < 3} onClick={() => void send("v1/asset/settings", "PATCH", { glMakerChecker: true, reason: glOffReason.trim() }, t("glMcSwitchedOn"))}>{t("glMcSwitchOn")}</Button>
            </div>
          )
        ) : null}
      </Card>

      <div style={{ height: 16 }} />
      <Card title={t("approvalSection")} padding>
        <p style={{ marginTop: 0 }}>{settings.capitalizeMakerChecker ? t("approvalOn") : t("approvalOff")}</p>
        {canManageCapitalisation ? (
          settings.capitalizeMakerChecker ? (
            settings.pendingRequests.some((r) => r.kind === "maker_checker_off") ? null : (
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

  /** A pending request: what is asked, by whom (you or someone else), and approve / reject for a DIFFERENT administrator. */
  function renderPending(r: PendingRequest) {
    const kindLabel = r.kind === "gl_heads_change" ? t("reqKindGlHeads") : r.kind === "gl_maker_checker_off" ? t("reqKindGlMcOff") : t("reqKindCapOff");
    const headRows = HEAD_FIELDS.filter((h) => r.heads[h.field] !== undefined);
    const rejectReason = rejectReasons[r.id] ?? "";
    return (
      <li key={r.id} data-testid={`pending-${r.kind}`} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
        <strong>{kindLabel}</strong>
        {r.reason ? <span style={{ fontSize: 13 }}>{t("reqReason", { reason: r.reason })}</span> : null}
        {headRows.length > 0 ? (
          <div>
            <div className="l">{t("reqHeads")}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {headRows.map((h) => <li key={h.field}>{t(h.labelKey)}: {r.heads[h.field] ?? t("notSet")}</li>)}
            </ul>
          </div>
        ) : null}
        {r.requestedByMe ? (
          <p role="status" style={{ color: "var(--warn)", fontSize: 13, margin: 0 }}>{t("reqMine")}</p>
        ) : (r.kind === "maker_checker_off" ? canManageCapitalisation : canManage) ? (
          <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
            <p role="status" style={{ fontSize: 13, margin: 0 }}>{t("reqNeedsYou")}</p>
            <Button type="button" disabled={busy} onClick={() => void send(`v1/asset/settings/requests/${r.id}/approve`, "POST", {}, t("decided"))}>{t("approve")}</Button>
            <label className="l" htmlFor={`gl-reject-${r.id}`}>{t("rejectReason")}</label>
            <input id={`gl-reject-${r.id}`} value={rejectReason} onChange={(e) => setRejectReasons({ ...rejectReasons, [r.id]: e.target.value })} maxLength={500} style={inputStyle} />
            <Button type="button" variant="ghost" disabled={busy || rejectReason.trim().length < 3} onClick={() => void send(`v1/asset/settings/requests/${r.id}/reject`, "POST", { reason: rejectReason.trim() }, t("decided"))}>{t("reject")}</Button>
          </div>
        ) : null}
      </li>
    );
  }
}
