"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type VerifyResponse = {
  data: {
    valid: boolean;
    signerCN: string | null;
    signedAt: string | null;
    certificateExpiry: string | null;
    issues: string[];
  };
};

const MAX_BYTES = 2 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the data: URL prefix, keep the base64 payload only
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function VerifyForm16Form() {
  const t = useTranslations("verifyForm16Form");
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse["data"] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t("chooseFileError"));
      fileRef.current?.focus();
      return;
    }
    if (file.type && file.type !== "application/pdf") {
      setError(t("onlyPdfError"));
      fileRef.current?.focus();
      return;
    }
    if (file.size === 0) {
      setError(t("emptyFileError"));
      fileRef.current?.focus();
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("fileTooLargeError"));
      fileRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const pdfBase64 = await fileToBase64(file);
      const res = await browserJson<VerifyResponse>("v1/payroll/tax/form16/verify", {
        method: "POST",
        body: JSON.stringify({ pdfBase64 }),
      });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ marginTop: 16 }}>
      <Card title={t("cardTitle")} padding>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("fileLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={inputId}
              ref={fileRef}
              type="file"
              accept="application/pdf"
              aria-required="true"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? errId : undefined}
              style={{ fontSize: 13 }}
            />
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {busy ? t("verifyingBtn") : t("verifyBtn")}
            </Button>
          </div>

          {error && (
            <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
              {error}
            </p>
          )}

          {result && (
            <div
              role="status"
              aria-live="polite"
              style={{
                borderRadius: 8,
                padding: 12,
                border: `1px solid ${result.valid ? "var(--goodbd)" : "var(--badbd)"}`,
                background: result.valid ? "var(--goodbg)" : "var(--badbg)",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {result.valid ? (
                  <><span aria-hidden="true">✅</span> {t("signatureValid")}</>
                ) : (
                  <><span aria-hidden="true">⚠️</span> {t("signatureInvalid")}</>
                )}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                {result.signerCN && <li>{t("signerLabel", { name: result.signerCN })}</li>}
                {result.signedAt && <li>{t("signedAtLabel", { date: result.signedAt })}</li>}
                {result.certificateExpiry && <li>{t("certExpiryLabel", { date: result.certificateExpiry })}</li>}
                {result.issues.length > 0 && (
                  <li>
                    {t("issuesLabel")}
                    <ul>
                      {result.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </form>
  );
}
