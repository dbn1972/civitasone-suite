"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog, Button } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { browserJson } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";

type DscConfig = {
  subjectCn: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sha256Fingerprint: string;
} & Record<string, unknown>;

// UX-017: now takes the read-error message as a parameter -- this function
// lives outside the component (no hook access), so the translated string is
// resolved by the caller and threaded through instead.
function fileToBase64(file: File, readErrorMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(readErrorMessage));
    reader.readAsDataURL(file);
  });
}

export function DscConfigForm({ initial }: { initial: DscConfig | null }) {
  const t = useTranslations("dscConfigForm");
  const router = useRouter();
  const [passphrase, setPassphrase] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Separate error state per action so a delete failure never gets announced
  // under the upload form's fields (and vice versa).
  const [error, setError] = useState<string | undefined>();
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [fileInvalid, setFileInvalid] = useState(false);
  const [passInvalid, setPassInvalid] = useState(false);
  const formError = useFormError("DSC certificate");

  const fileId = useId();
  const passId = useId();
  const errId = useId();

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const hasFile = !!fileRef.current?.files?.[0];
    const hasPass = !!passphrase.trim();
    setFileInvalid(!hasFile);
    setPassInvalid(!hasPass);
    if (!hasFile || !hasPass) {
      setError(t("requiredFieldsError"));
      if (!hasFile) {
        fileRef.current?.focus();
      } else {
        passRef.current?.focus();
      }
      return;
    }
    setConfirmOpen(true);
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const p12Base64 = await fileToBase64(file, t("p12ReadError"));
      const res = await browserJson<{ data: DscConfig }>("v1/payroll/dsc-config", {
        method: "PUT",
        body: JSON.stringify({ p12Base64, passphrase }),
      });
      setConfirmOpen(false);
      setMessage(t("uploadedMessage", { subjectCn: res.data.subjectCn, date: formatIndianDate(res.data.notAfter) }));
      setPassphrase("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setDeleteError(undefined);
    try {
      await browserJson("v1/payroll/dsc-config", { method: "DELETE" });
      setDeleteConfirmOpen(false);
      setMessage(t("removedMessage"));
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {initial ? (
        <div className="fields" style={{ marginBottom: 16 }}>
          <div className="fld">
            <div className="l">{t("subjectCnLabel")}</div>
            <div className="v">{initial.subjectCn}</div>
          </div>
          <div className="fld">
            <div className="l">{t("serialNumberLabel")}</div>
            <div className="v">{initial.serialNumber}</div>
          </div>
          <div className="fld">
            <div className="l">{t("validFromLabel")}</div>
            <div className="v">{formatIndianDate(initial.notBefore)}</div>
          </div>
          <div className="fld">
            <div className="l">{t("validUntilLabel")}</div>
            <div className="v">{formatIndianDate(initial.notAfter)}</div>
          </div>
          <div className="fld">
            <div className="l">{t("sha256Label")}</div>
            <div className="v" style={{ fontFamily: "monospace", fontSize: 12 }}>{initial.sha256Fingerprint}</div>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "var(--mut)", marginBottom: 14 }}>
          {t("noneConfiguredMessage")}
        </p>
      )}

      <form onSubmit={openConfirm}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={fileId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("fileLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={fileId}
              ref={fileRef}
              type="file"
              accept=".p12,.pfx"
              aria-required="true"
              aria-invalid={fileInvalid || undefined}
              aria-describedby={fileInvalid ? errId : undefined}
              onChange={() => setFileInvalid(false)}
              style={{ fontSize: 13 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={passId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("passphraseLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={passId}
              ref={passRef}
              type="password"
              value={passphrase}
              onChange={(e) => {
                setPassphrase(e.target.value);
                setPassInvalid(false);
              }}
              aria-required="true"
              aria-invalid={passInvalid || undefined}
              aria-describedby={passInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        </div>
        <p style={{ fontSize: 11, color: "var(--mut)", marginTop: 6 }}>{t("maxSizeHint")}</p>
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy}>
            {initial ? t("replaceBtn") : t("uploadBtn")}
          </Button>
          {initial && (
            <Button
              variant="secondary"
              style={{ minHeight: 44 }}
              disabled={busy}
              onClick={() => {
                setDeleteError(undefined);
                setDeleteConfirmOpen(true);
              }}
            >
              {t("removeBtn")}
            </Button>
          )}
        </div>
        {error && !confirmOpen && (
          <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
            {message}
          </p>
        )}

        <ConfirmDialog
          open={confirmOpen}
          title={t("uploadConfirmTitle")}
          danger
          confirmLabel={t("uploadConfirmLabel")}
          busy={busy}
          errorMessage={error}
          description={initial ? t("uploadConfirmDescriptionReplace") : t("uploadConfirmDescriptionNew")}
          onConfirm={() => void upload()}
          onCancel={() => !busy && setConfirmOpen(false)}
        />

        <ConfirmDialog
          open={deleteConfirmOpen}
          title={t("removeConfirmTitle")}
          danger
          confirmLabel={t("removeConfirmLabel")}
          busy={busy}
          errorMessage={deleteError}
          description={t("removeConfirmDescription")}
          onConfirm={() => void remove()}
          onCancel={() => !busy && setDeleteConfirmOpen(false)}
        />
      </form>
    </div>
  );
}
