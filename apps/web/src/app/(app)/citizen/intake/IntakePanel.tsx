"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, StatusPill, ConfirmDialog } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export interface IntakeServiceOption { id: string; name: string; ownerDepartment: string; channels: string[] }
interface Draft { id: string; status: string; channel: string; assistedBy: string | null }
interface Ack { applicationId: string; trackingNo: string; status: string; channel: string; acknowledgedAt: string }
interface Track { trackingNo: string; status: string; channel: string; applicationId: string }

const ALL_CHANNELS = ["portal", "mobile", "counter", "assisted", "whatsapp", "api"] as const;
const ASSISTED_CHANNELS = new Set(["counter", "assisted"]);

/** SVC-082 — draft → submit (acknowledgement + tracking) → track. */
export function IntakePanel({ services, assistingOfficer }: { services: IntakeServiceOption[]; assistingOfficer: string | null }) {
  const t = useTranslations("citizenIntake");
  // GAP-CITIZEN-CATALOGUE-04: a catalogue "Apply" deep link can prefill the
  // service via ?serviceId=; only honour it when it matches a known service.
  const searchParams = useSearchParams();
  const prefillServiceId = searchParams.get("serviceId");
  const [serviceId, setServiceId] = useState(
    prefillServiceId && services.some((s) => s.id === prefillServiceId) ? prefillServiceId : "",
  );
  const [channel, setChannel] = useState("portal");
  const [assistedConsent, setAssistedConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ack, setAck] = useState<Ack | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [trackNo, setTrackNo] = useState("");
  const [track, setTrack] = useState<Track | null>(null);
  const formError = useFormError("intake application");

  const selected = useMemo(() => services.find((s) => s.id === serviceId) ?? null, [services, serviceId]);
  // GAP-CITIZEN-INTAKE-02: offer only the channels the chosen service enables.
  const availableChannels = useMemo(() => {
    const svcChannels = selected?.channels?.length ? selected.channels : [...ALL_CHANNELS];
    return ALL_CHANNELS.filter((c) => svcChannels.includes(c));
  }, [selected]);

  const channelLabel = (c: string): string => {
    const key: Record<string, string> = {
      portal: "channelPortal", mobile: "channelMobile", counter: "channelCounter",
      assisted: "channelAssisted", whatsapp: "channelWhatsapp", api: "channelApi",
    };
    return key[c] ? t(key[c]) : c;
  };

  // GAP-CITIZEN-INTAKE-04: assisted/counter channels require a consent attestation.
  const assistedChannel = ASSISTED_CHANNELS.has(channel);
  const consentOk = !assistedChannel || assistedConsent;

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`/api/proxy${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
    return (await res.json()) as T;
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setAck(null);
    try {
      const body: Record<string, unknown> = { serviceId, channel };
      if (assistedChannel) body.assistedConsent = true;
      setDraft(await post<Draft>("/v1/citizen/intake/drafts", body));
    } catch (caught) { setError(formError.fromException("save", caught).message); } finally { setBusy(false); }
  }

  async function submitDraft() {
    if (!draft) return;
    setConfirmOpen(false);
    setBusy(true); setError("");
    try {
      const a = await post<Ack>(`/v1/citizen/intake/drafts/${draft.id}/submit`, {});
      setAck(a); setTrackNo(a.trackingNo);
      // GAP-CITIZEN-INTAKE-03: keep the draft visible until the ack arrives.
      setDraft(null);
    } catch (caught) { setError(formError.fromException("save", caught).message); } finally { setBusy(false); }
  }

  async function doTrack(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setTrack(null);
    try {
      const res = await fetch(`/api/proxy/v1/citizen/intake/track/${encodeURIComponent(trackNo)}`);
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "load"));
      setTrack((await res.json()) as Track);
    } catch (caught) { setError(formError.fromException("load", caught).message); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <form onSubmit={saveDraft} className="pad" style={{ maxWidth: 620 }}>
          <h4 style={{ marginTop: 0 }}>{t("draftFormTitle")}</h4>

          {/* GAP-CITIZEN-INTAKE-02: service chosen by name + owner, not a raw UUID. */}
          <label htmlFor="in-svc" style={labelStyle}>{t("serviceLabel")}</label>
          <select id="in-svc" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setChannel("portal"); }} style={inputStyle}>
            <option value="">{t("servicePlaceholder")}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.ownerDepartment ? `${s.name} — ${s.ownerDepartment}` : s.name}</option>
            ))}
          </select>
          {services.length === 0 ? <p style={{ fontSize: 12, color: "var(--muted)" }}>{t("serviceLoadError")}</p> : null}

          <label htmlFor="in-ch" style={labelStyle}>{t("channelLabel")}</label>
          <select id="in-ch" value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle}>
            {availableChannels.map((c) => (
              <option key={c} value={c}>{channelLabel(c)}</option>
            ))}
          </select>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -4, marginBottom: 8 }}>{t("channelNote")}</p>

          {/* GAP-CITIZEN-INTAKE-04: assisted/counter consent + assisting officer. */}
          {assistedChannel ? (
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>{t("assistingOfficerLabel")}</label>
              <div style={{ fontSize: 13, marginBottom: 8 }}>{assistingOfficer ?? "—"}</div>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                <input type="checkbox" checked={assistedConsent} onChange={(e) => setAssistedConsent(e.target.checked)} style={{ marginTop: 3, minWidth: 18, minHeight: 18 }} />
                <span>{t("assistedConsentLabel")}</span>
              </label>
            </div>
          ) : null}

          <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy || !serviceId || !consentOk}>
            {busy ? t("saving") : t("saveDraft")}
          </Button>

          {draft ? (
            <div className="pad" style={{ marginTop: 12, background: "var(--surface, #f8fafc)", borderRadius: 8 }}>
              <span>
                {t("draftSavedPrefix")} ({channelLabel(draft.channel)}
                {draft.assistedBy ? `, ${t("assistedByLabel")} ${draft.assistedBy}` : ""}).
              </span>{" "}
              <Button type="button" variant="primary" style={{ minHeight: 40 }} onClick={() => setConfirmOpen(true)} disabled={busy}>{t("submitForAck")}</Button>
            </div>
          ) : null}

          {ack ? (
            <div role="status" className="pad" style={{ marginTop: 12, background: "var(--good-bg, #ecfdf3)", borderRadius: 8 }}>
              <div>{t("ackPrefix")} <strong>{ack.trackingNo}</strong></div>
              <div style={{ fontSize: 13 }}>{t("applicationIdLabel")}: <strong>{ack.applicationId}</strong></div>
              <div style={{ marginTop: 4 }}><StatusPill status={ack.status} /></div>
            </div>
          ) : null}
          {error ? <p role="alert" style={{ color: "var(--bad, #b42318)", fontSize: 13 }}>{error}</p> : null}
        </form>
      </div>

      <div className="card">
        <form onSubmit={doTrack} className="pad" style={{ maxWidth: 620 }}>
          <h4 style={{ marginTop: 0 }}>{t("trackFormTitle")}</h4>
          <label htmlFor="in-track" style={labelStyle}>{t("trackingNumberLabel")}</label>
          <input id="in-track" value={trackNo} onChange={(e) => setTrackNo(e.target.value)} style={inputStyle} placeholder={t("trackingNumberPlaceholder")} />
          <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy || !trackNo}>{t("track")}</Button>
          {track ? (
            <div className="pad" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <strong>{track.trackingNo}</strong> <StatusPill status={track.status} /> <span style={{ color: "var(--muted)", fontSize: 13 }}>({channelLabel(track.channel)})</span>
            </div>
          ) : null}
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmSubmitTitle")}
        description={t("confirmSubmitBody")}
        confirmLabel={t("confirmSubmit")}
        cancelLabel={t("cancel")}
        onConfirm={() => void submitDraft()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
