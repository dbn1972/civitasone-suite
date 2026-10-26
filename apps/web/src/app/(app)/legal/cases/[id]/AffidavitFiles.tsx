"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "../../../../_components/ds";

/**
 * GAP-LEGAL-CASES-DETAIL-01 (owner decision #9): affidavit file attachments.
 * The file goes straight from the browser to the document store through a
 * short-lived upload target issued by legal-service (which registers it with
 * document-service: virus scan, OCR, retention). Only legal roles can open a file.
 */
type Item = { id: string; fileName: string; sizeBytes: number; status: string; openable: boolean; uploadedAt: string };
type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; items: Item[] };

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT_MIME = ["application/pdf", "image/jpeg", "image/png", "image/tiff"];

const fmtSize = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function AffidavitFiles({ caseId }: { caseId: string }) {
  const t = useTranslations("legalAffidavits");
  const base = `/api/proxy/v1/legal/cases/${encodeURIComponent(caseId)}/affidavits`;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) { setLoad({ kind: "error" }); return; }
      const json = (await res.json()) as { items?: Item[] };
      setLoad({ kind: "ready", items: Array.isArray(json.items) ? json.items : [] });
    } catch {
      setLoad({ kind: "error" });
    }
  }, [base]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    setMessage("");
    if (!file) { setMessage(t("noFile")); return; }
    if (!ACCEPT_MIME.includes(file.type)) { setMessage(t("badType")); return; }
    if (file.size > MAX_BYTES) { setMessage(t("tooLarge")); return; }
    setBusy(true);
    try {
      const start = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
      });
      if (!start.ok) { setMessage(t("uploadFailed")); return; }
      const { id, upload: target } = (await start.json()) as { id: string; upload: { url: string; headers: Record<string, string> } };
      const put = await fetch(target.url, { method: "PUT", headers: target.headers, body: file });
      if (!put.ok) { setMessage(t("uploadFailed")); return; }
      const done = await fetch(`${base}/${encodeURIComponent(id)}/complete`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      if (!done.ok) { setMessage(t("uploadFailed")); return; }
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch {
      setMessage(t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function openFile(id: string) {
    setOpeningId(id);
    setMessage("");
    try {
      const res = await fetch(`${base}/${encodeURIComponent(id)}/download`);
      if (!res.ok) { setMessage(t("openFailed")); return; }
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      setMessage(t("openFailed"));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="card" data-testid="affidavit-files">
      <div className="card-h"><h3>{t("title")}</h3></div>
      <div className="pad">
        <label className="label" htmlFor="affidavitFile">{t("chooseFile")}</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input id="affidavitFile" ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" className="inp" style={{ minHeight: 44 }} />
          <Button onClick={() => void upload()} disabled={busy} aria-busy={busy} style={{ minHeight: 44 }}>
            {busy ? t("uploading") : t("upload")}
          </Button>
        </div>
        <div role="status" aria-live="polite">
          {message ? <p role="alert" style={{ marginTop: 8, color: "var(--bad)", fontSize: "0.875rem" }}>{message}</p> : null}
        </div>
        <p style={{ fontSize: 12, color: "var(--mut)", margin: "8px 0 12px" }}>{t("legalOnly")}</p>

        {load.kind === "loading" ? null : load.kind === "error" ? (
          <div role="alert">
            <p style={{ color: "var(--bad)" }}>{t("loadError")}</p>
            <Button variant="ghost" onClick={() => { setLoad({ kind: "loading" }); void refresh(); }}>{t("retry")}</Button>
          </div>
        ) : load.items.length === 0 ? (
          <EmptyState icon="📎" title={t("title")} message={t("empty")} />
        ) : (
          <table className="tbl" style={{ width: "100%" }}>
            <thead>
              <tr><th>{t("colFile")}</th><th>{t("colStatus")}</th><th>{t("colSize")}</th><th /></tr>
            </thead>
            <tbody>
              {load.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.fileName}</td>
                  <td>{t(`status.${it.status}` as never)}</td>
                  <td>{fmtSize(it.sizeBytes)}</td>
                  <td>
                    {it.openable ? (
                      <Button variant="ghost" onClick={() => void openFile(it.id)} disabled={openingId === it.id}>
                        {openingId === it.id ? t("opening") : t("open")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
