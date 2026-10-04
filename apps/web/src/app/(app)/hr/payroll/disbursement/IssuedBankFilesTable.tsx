"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDate } from "@/lib/formatters";
import { SigningBadge } from "./SigningBadge";
import type { IssuedFile } from "./signingState";

/** Saves a Response body as a file named from its content-disposition header (or `fallback`). */
export async function saveResponseAsFile(res: Response, fallback: string): Promise<void> {
  const match = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallback;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Issued bank files with their server-stated signing state, and the detached
 * signature (.sig / .p7s) download. The server never stores the file itself,
 * only its name, sha256 and signature.
 */
export function IssuedBankFilesTable({ files }: { files: IssuedFile[] }) {
  const t = useTranslations("bankFileSigning");
  const formError = useFormError("bank file signature");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function downloadSignature(f: IssuedFile) {
    setBusyId(f.id);
    setError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/disbursement/files/${encodeURIComponent(f.id)}/signature`);
      if (!res.ok) {
        setError((await formError.fromResponse(res, "load")).message);
        return;
      }
      await saveResponseAsFile(res, `${f.fileName}.sig`);
    } catch (caught) {
      setError(formError.fromException("load", caught).message);
    } finally {
      setBusyId(null);
    }
  }

  const columns = [t("colFile"), t("colRun"), t("colIssued"), t("colRecords"), t("colSigning"), t("colSignature")];
  return (
    <div className="pad">
      {error && <p role="alert" className="pill bad" style={{ width: "fit-content", marginBottom: 12 }}>{error}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--line2)" }}>
              {columns.map((h) => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "start", fontWeight: 600, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} style={{ borderBottom: "1px solid var(--line2)" }}>
                <td style={{ padding: "10px 12px" }}>
                  <div className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{f.fileName}</div>
                  {f.fileSha256 && (
                    <div style={{ fontSize: 11, color: "var(--ink2)" }}>
                      {t("sha256Short")} <span className="mono">{f.fileSha256.slice(0, 12)}…</span>
                    </div>
                  )}
                </td>
                <td style={{ padding: "10px 12px" }}>{f.runNo ?? "—"}{f.month ? ` · ${f.month}` : ""}</td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{formatIndianDate(f.createdAt)}</td>
                <td style={{ padding: "10px 12px", textAlign: "end" }}>{f.lineCount}</td>
                <td style={{ padding: "10px 12px" }}>
                  <SigningBadge format={f.signatureFormat} signed={f.signed} />
                  {f.encryptedToBank && <div style={{ fontSize: 11, color: "var(--ink2)", marginTop: 2 }}>{t("encryptedNote")}</div>}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {f.hasDetachedSignature ? (
                    <Button
                      type="button"
                      variant="secondary"
                      style={{ minHeight: 32, fontSize: 12 }}
                      disabled={busyId === f.id}
                      aria-label={t("downloadSignatureAria", { name: f.fileName })}
                      onClick={() => void downloadSignature(f)}
                    >
                      {t("downloadSignatureBtn")}
                    </Button>
                  ) : (
                    <span style={{ color: "var(--ink2)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
