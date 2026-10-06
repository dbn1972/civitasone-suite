"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTICE_VERSION = "dpdp-2024-v1";

interface Match { id: string; serviceId: string; outcome: string; strength?: string; notified?: boolean; createdAt?: string }
interface ConsentState { active: boolean; grantedAt?: string | null; grantedBy?: string | null; purpose?: string | null }

/**
 * SVC-090 — consent-gated discovery.
 *
 * GAP-CITIZEN-DISCOVERY-01: DPDP consent can no longer be recorded by just
 * typing a UUID — a purpose notice, an explicit attestation checkbox and a
 * channel are required, and the current consent record + a Withdraw control
 * are shown. GAP-CITIZEN-DISCOVERY-02: Run discovery (which NOTIFIES the
 * citizen as a side effect) is behind a ConfirmDialog. GAP-CITIZEN-DISCOVERY-05:
 * the profile textarea no longer ships a fabricated age-65 sample as the real
 * payload. GAP-CITIZEN-DISCOVERY-04: errors are friendly/i18n, never raw bodies.
 */
export function DiscoveryPanel({ serviceNames = {} }: { serviceNames?: Record<string, string> }) {
  const t = useTranslations("citizenDiscovery");
  const [citizenId, setCitizenId] = useState("");
  const [attested, setAttested] = useState(false);
  const [channel, setChannel] = useState<"in_person" | "otp" | "e_sign">("in_person");
  const [profile, setProfile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const validId = UUID_RE.test(citizenId.trim());

  const loadConsentAndMatches = useCallback(async (id: string) => {
    if (!UUID_RE.test(id.trim())) return;
    try {
      const [cRes, mRes] = await Promise.all([
        fetch(`/api/proxy/v1/citizen/discovery/consent?citizenId=${encodeURIComponent(id)}`),
        fetch(`/api/proxy/v1/citizen/discovery/matches?citizenId=${encodeURIComponent(id)}`),
      ]);
      if (cRes.ok) {
        const body = (await cRes.json()) as { active?: boolean; consent?: Record<string, unknown> | null };
        setConsent({
          active: Boolean(body.active),
          grantedAt: typeof body.consent?.createdAt === "string" ? body.consent.createdAt : null,
          grantedBy: typeof body.consent?.createdBy === "string" ? body.consent.createdBy : null,
          purpose: typeof body.consent?.purpose === "string" ? body.consent.purpose : null,
        });
      }
      if (mRes.ok) {
        const body = (await mRes.json()) as { data?: unknown };
        setMatches(Array.isArray(body.data) ? (body.data as Match[]) : []);
      }
    } catch {
      /* non-fatal: the panel still works without the pre-loaded status */
    }
  }, []);

  useEffect(() => {
    if (validId) void loadConsentAndMatches(citizenId);
    else { setConsent(null); setMatches([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citizenId]);

  async function doGrant() {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/citizen/discovery/consent", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ citizenId, purpose: t("consentPurpose"), channel, noticeVersion: NOTICE_VERSION }),
      });
      if (!res.ok && res.status !== 409) throw await userFacingErrorFromResponse(res, "save", "consent");
      setMessage(t("consentRecorded"));
      await loadConsentAndMatches(citizenId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("consentFailed"));
    } finally { setBusy(false); }
  }

  async function doWithdraw() {
    setConfirmWithdraw(false);
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/citizen/discovery/consent/revoke", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ citizenId }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save", "consent");
      setMessage(t("consentWithdrawn"));
      await loadConsentAndMatches(citizenId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("consentFailed"));
    } finally { setBusy(false); }
  }

  async function doRun() {
    setConfirmRun(false);
    setBusy(true); setError(""); setMessage(""); setMatches([]);
    try {
      let parsed: unknown = {};
      if (profile.trim() !== "") {
        try { parsed = JSON.parse(profile); } catch { throw new Error(t("profileInvalid")); }
      }
      const res = await fetch("/api/proxy/v1/citizen/discovery/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ citizenId, profile: parsed }),
      });
      if (res.status === 403) throw new Error(t("consentRequired"));
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save", "discovery");
      const body = (await res.json()) as { matches?: Match[]; notified?: number };
      const found = Array.isArray(body.matches) ? body.matches : [];
      setMatches(found);
      setMessage(t("runResult", { matched: found.length, notified: body.notified ?? 0 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("discoveryFailed"));
    } finally { setBusy(false); }
  }

  const profileEmptyOrInvalid = (() => {
    if (profile.trim() === "") return true;
    try { JSON.parse(profile); return false; } catch { return true; }
  })();

  return (
    <div className="card">
      <form onSubmit={(e) => e.preventDefault()} className="pad" style={{ maxWidth: 640 }}>
        <label htmlFor="disc-citizen" style={labelStyle}>{t("citizenIdLabel")}</label>
        <input id="disc-citizen" value={citizenId} onChange={(e) => setCitizenId(e.target.value)} style={inputStyle} placeholder="00000000-0000-4000-8000-000000000000" />
        {citizenId !== "" && !validId ? <p style={{ color: "#b42318", fontSize: 12, marginTop: -4 }}>{t("citizenIdInvalid")}</p> : null}

        {/* Consent block */}
        <div className="pad" style={{ background: "var(--panel-2, #f8fafc)", borderRadius: 8, marginBottom: 12 }}>
          <p style={{ fontSize: 13, marginTop: 0 }}>{t("consentPurpose")}</p>
          {consent?.active ? (
            <div style={{ fontSize: 13 }}>
              <strong>{t("consentActive")}</strong>
              {consent.grantedAt ? <div>{t("consentGrantedAt", { date: formatIndianDate(consent.grantedAt) })}</div> : null}
              <div style={{ marginTop: 8 }}>
                <Button type="button" variant="danger" style={{ minHeight: 40 }} disabled={busy} onClick={() => setConfirmWithdraw(true)}>
                  {t("withdrawConsent")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <label htmlFor="disc-channel" style={labelStyle}>{t("channelLabel")}</label>
              <select id="disc-channel" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} style={inputStyle}>
                <option value="in_person">{t("channelInPerson")}</option>
                <option value="otp">{t("channelOtp")}</option>
                <option value="e_sign">{t("channelESign")}</option>
              </select>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 8 }}>
                <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} style={{ marginTop: 3 }} />
                <span>{t("consentAttestation")}</span>
              </label>
              <Button type="button" variant="primary" style={{ minHeight: 44 }} disabled={busy || !validId || !attested} onClick={doGrant}>
                {t("grantConsent")}
              </Button>
            </>
          )}
        </div>

        <label htmlFor="disc-profile" style={labelStyle}>{t("profileLabel")}</label>
        <textarea
          id="disc-profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          style={{ ...inputStyle, minHeight: 120, fontFamily: "monospace" }}
          placeholder={'{\n  "age": 65,\n  "income_proof": "x"\n}'}
        />
        <Button type="button" variant="primary" style={{ minHeight: 44 }} disabled={busy || !validId || profileEmptyOrInvalid} onClick={() => setConfirmRun(true)}>
          {busy ? t("running") : t("runDiscovery")}
        </Button>

        {message ? <p role="status" style={{ color: "#067647", fontSize: 13 }}>{message}</p> : null}
        {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
      </form>

      {matches.length > 0 ? (
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <strong style={{ fontSize: 13 }}>{t("likelyEligible")}</strong>
          <ul style={{ marginTop: 8, fontSize: 13 }}>
            {matches.map((m) => (
              <li key={m.id}>
                {serviceNames[m.serviceId] ?? m.serviceId} — {humanizeStatus(m.outcome)}
                {m.strength ? ` (${humanizeStatus(m.strength)})` : ""}
                {m.createdAt ? ` · ${formatIndianDate(m.createdAt)}` : ""}
                {m.notified ? ` · ${t("notified")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRun}
        title={t("confirmRunTitle")}
        description={t("confirmRunBody")}
        confirmLabel={t("runDiscovery")}
        onConfirm={() => void doRun()}
        onCancel={() => setConfirmRun(false)}
      />
      <ConfirmDialog
        open={confirmWithdraw}
        title={t("confirmWithdrawTitle")}
        description={t("confirmWithdrawBody")}
        confirmLabel={t("withdrawConsent")}
        danger
        onConfirm={() => void doWithdraw()}
        onCancel={() => setConfirmWithdraw(false)}
      />
    </div>
  );
}
