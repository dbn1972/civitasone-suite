"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { humanizeStatus } from "@/lib/formatters";
import { Button } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export interface DocumentServiceOption { id: string; name: string; serviceKey: string }
interface ChecklistItem { docType: string; label?: string; mandatory: boolean; provided: boolean; verified: boolean }
interface Checklist { source: string; items: ChecklistItem[]; complete: boolean }
interface Uploaded { id: string; verificationStatus: string; providerStatus?: string; configured?: boolean }

/** SVC-084 — upload / DigiLocker fetch + required-document checklist. */
export function DocumentPanel({ services }: { services: DocumentServiceOption[] }) {
  const t = useTranslations("citizenDocuments");
  const [serviceId, setServiceId] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [docType, setDocType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  // GAP-CITIZEN-DOCUMENTS-01: the file the citizen attaches. Upload now presigns
  // a direct-to-storage PUT, uploads the bytes, then records the object key —
  // no document can be recorded without a real file.
  const [file, setFile] = useState<File | null>(null);
  // GAP-CITIZEN-DOCUMENTS-02: probe whether DigiLocker is configured so the
  // fetch control is disabled (with an explanation) when the provider is absent,
  // rather than offering a button that always returns provider_unconfigured.
  const [digilockerConfigured, setDigilockerConfigured] = useState<boolean | null>(null);
  // DPDP consent attestation required before an operator fetches a document.
  const [consent, setConsent] = useState(false);
  const formError = useFormError("document");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/citizen/documents/digilocker-status");
        if (!res.ok) { if (active) setDigilockerConfigured(false); return; }
        const body = (await res.json()) as { configured?: boolean };
        if (active) setDigilockerConfigured(Boolean(body.configured));
      } catch { if (active) setDigilockerConfigured(false); }
    })();
    return () => { active = false; };
  }, []);

  /**
   * GAP-CITIZEN-DOCUMENTS-02: begin the real DigiLocker OAuth consent redirect.
   * POST /authorize mints PKCE + state server-side and returns an authorizeUrl;
   * we redirect the browser to the provider. A 409 PROVIDER_UNCONFIGURED keeps
   * the honest disabled state (never a fabricated docUri or fake success).
   */
  async function startDigiLocker() {
    setBusy(true); setError(""); setUploaded(null);
    try {
      const redirectUri = `${window.location.origin}/citizen/documents/digilocker/callback`;
      const res = await fetch("/api/proxy/v1/citizen/documents/digilocker/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType, purpose: t("digilockerPurpose", { docType }), redirectUri,
          applicationId: applicationId || undefined, serviceId,
        }),
      });
      if (res.status === 409) {
        // Provider unconfigured: stay honest and keep the disabled state.
        setDigilockerConfigured(false);
        setError(t("digilockerUnavailable"));
        return;
      }
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
      const body = (await res.json()) as { authorizeUrl?: string };
      if (!body.authorizeUrl) { setError(t("digilockerUnavailable")); return; }
      window.location.assign(body.authorizeUrl);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`/api/proxy${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
    return (await res.json()) as T;
  }

  async function upload() {
    setBusy(true); setError(""); setUploaded(null);
    try {
      // GAP-CITIZEN-DOCUMENTS-01: real presign → PUT to storage → record key.
      if (!file) { setError(t("fileRequired")); return; }
      const presign = await post<{ uploadUrl: string; key: string; method: string; headers?: Record<string, string> }>(
        "/v1/citizen/documents/presign",
        { filename: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size },
      );
      const put = await fetch(presign.uploadUrl, { method: "PUT", headers: presign.headers ?? {}, body: file });
      if (!put.ok) { setError(t("uploadFailed")); return; }
      setUploaded(await post<Uploaded>("/v1/citizen/documents/upload", {
        applicationId: applicationId || undefined, serviceId, docType, storageKey: presign.key,
      }));
    } catch (caught) { setError(formError.fromException("save", caught).message); } finally { setBusy(false); }
  }

  async function loadChecklist(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setChecklist(null);
    try {
      const qs = new URLSearchParams({ serviceId, ...(applicationId ? { applicationId } : {}) });
      const res = await fetch(`/api/proxy/v1/citizen/documents/checklist?${qs.toString()}`);
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "load"));
      setChecklist((await res.json()) as Checklist);
    } catch (caught) { setError(formError.fromException("load", caught).message); } finally { setBusy(false); }
  }

  const docTypeOptions = checklist?.items ?? [];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="pad" style={{ maxWidth: 640 }}>
          <h4 style={{ marginTop: 0 }}>{t("submitFormTitle")}</h4>

          {/* GAP-CITIZEN-DOCUMENTS-03: choose a service by name; its id travels in the request. */}
          <label htmlFor="d-svc" style={labelStyle}>{t("serviceLabel")}</label>
          <select id="d-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={inputStyle}>
            <option value="">{t("servicePlaceholder")}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {services.length === 0 ? <p style={{ fontSize: 12, color: "var(--muted)" }}>{t("serviceLoadError")}</p> : null}

          <label htmlFor="d-app" style={labelStyle}>{t("applicationIdLabel")}</label>
          <input id="d-app" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} style={inputStyle} />

          {/* GAP-CITIZEN-DOCUMENTS-04: docType is chosen from the checklist, not free text. */}
          <label htmlFor="d-type" style={labelStyle}>{t("docTypeLabel")}</label>
          {docTypeOptions.length > 0 ? (
            <select id="d-type" value={docType} onChange={(e) => setDocType(e.target.value)} style={inputStyle}>
              <option value="">{t("docTypeSelectPlaceholder")}</option>
              {docTypeOptions.map((i) => (
                <option key={i.docType} value={i.docType}>{i.label ?? humanizeStatus(i.docType)}</option>
              ))}
            </select>
          ) : (
            <p id="d-type" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{t("docTypeHint")}</p>
          )}

          {/* GAP-CITIZEN-DOCUMENTS-01: attach the actual file to upload. */}
          <label htmlFor="d-file" style={labelStyle}>{t("fileLabel")}</label>
          <input
            id="d-file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ ...inputStyle, padding: 6 }}
          />

          {/* GAP-CITIZEN-DOCUMENTS-02: DPDP consent attestation before a DigiLocker fetch. */}
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, margin: "4px 0 12px" }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, minWidth: 18, minHeight: 18 }} />
            <span>{t("consentLabel")}</span>
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant="primary" style={{ minHeight: 44 }} disabled={busy || !docType || !serviceId || !file} onClick={() => upload()}>{t("upload")}</Button>
            <Button
              type="button"
              variant="primary"
              style={{ minHeight: 44 }}
              disabled={busy || !docType || !serviceId || !consent || digilockerConfigured === false}
              onClick={() => startDigiLocker()}
            >
              {t("fetchDigilocker")}
            </Button>
          </div>
          {digilockerConfigured === false ? (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("digilockerUnavailable")}</p>
          ) : null}

          {uploaded ? (
            <div className="pad" style={{ marginTop: 12, background: "var(--surface, #f8fafc)", borderRadius: 8, fontSize: 13 }}>
              <div>{t("resultSubmitted", { status: humanizeStatus(uploaded.verificationStatus) })}</div>
              {uploaded.providerStatus ? (
                <div>{t("resultDigilocker", { status: humanizeStatus(uploaded.providerStatus) })}</div>
              ) : null}
              {uploaded.configured === false ? (
                <div style={{ color: "var(--bad, #b42318)" }}>{t("resultProviderUnconfigured")}</div>
              ) : null}
            </div>
          ) : null}
          {error ? <p role="alert" style={{ color: "var(--bad, #b42318)", fontSize: 13 }}>{error}</p> : null}
        </div>
      </div>

      <div className="card">
        <form onSubmit={loadChecklist} className="pad" style={{ maxWidth: 640 }}>
          <h4 style={{ marginTop: 0 }}>{t("checklistTitle")}</h4>
          <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy || !serviceId}>{t("loadChecklist")}</Button>
          {checklist ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                {t("checklistSource", { source: humanizeStatus(checklist.source) })} · {checklist.complete ? t("checklistComplete") : t("checklistIncomplete")}
              </div>
              <ul style={{ fontSize: 13, listStyle: "none", padding: 0 }}>
                {checklist.items.map((i) => (
                  <li key={i.docType} style={{ padding: "4px 0" }}>
                    <span style={{ color: i.verified ? "var(--good, #067647)" : i.provided ? "var(--warn, #b54708)" : "var(--bad, #b42318)" }}>
                      {i.verified ? `✔ ${t("statusVerified")}` : i.provided ? `• ${t("statusProvided")}` : `✗ ${t("statusMissing")}`}
                    </span>{" "}
                    {i.label ?? humanizeStatus(i.docType)}{i.mandatory ? ` (${t("required")})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
