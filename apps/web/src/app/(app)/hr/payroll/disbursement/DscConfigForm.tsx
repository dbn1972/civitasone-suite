"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { browserJson } from "@/lib/api/browserClient";

type DscConfig = {
  subjectCn: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sha256Fingerprint: string;
} & Record<string, unknown>;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read the P12 file."));
    reader.readAsDataURL(file);
  });
}

export function DscConfigForm({ initial }: { initial: DscConfig | null }) {
  const router = useRouter();
  const [passphrase, setPassphrase] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const fileId = useId();
  const passId = useId();

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    if (!fileRef.current?.files?.[0] || !passphrase.trim()) {
      setError("Select a P12 file and enter its passphrase.");
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
      const p12Base64 = await fileToBase64(file);
      const res = await browserJson<{ data: DscConfig }>("v1/payroll/dsc-config", {
        method: "PUT",
        body: JSON.stringify({ p12Base64, passphrase }),
      });
      setConfirmOpen(false);
      setMessage(`DSC certificate uploaded for ${res.data.subjectCn}. Valid until ${formatIndianDate(res.data.notAfter)}.`);
      setPassphrase("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Certificate upload failed. Check the P12 file and passphrase.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(undefined);
    try {
      await browserJson("v1/payroll/dsc-config", { method: "DELETE" });
      setDeleteConfirmOpen(false);
      setMessage("DSC configuration removed. This tenant now runs in unsigned mode.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the DSC configuration.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {initial ? (
        <div className="fields" style={{ marginBottom: 16 }}>
          <div className="fld">
            <div className="l">Subject CN</div>
            <div className="v">{initial.subjectCn}</div>
          </div>
          <div className="fld">
            <div className="l">Serial Number</div>
            <div className="v">{initial.serialNumber}</div>
          </div>
          <div className="fld">
            <div className="l">Valid From</div>
            <div className="v">{formatIndianDate(initial.notBefore)}</div>
          </div>
          <div className="fld">
            <div className="l">Valid Until</div>
            <div className="v">{formatIndianDate(initial.notAfter)}</div>
          </div>
          <div className="fld">
            <div className="l">SHA-256 Fingerprint</div>
            <div className="v" style={{ fontFamily: "monospace", fontSize: 12 }}>{initial.sha256Fingerprint}</div>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "var(--mut)", marginBottom: 14 }}>
          No DSC is configured for this tenant. Digitally signed disbursement outputs are unavailable
          until a certificate is uploaded.
        </p>
      )}

      <form onSubmit={openConfirm}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={fileId} style={{ fontSize: 13, fontWeight: 600 }}>
              P12 Keystore File <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input id={fileId} ref={fileRef} type="file" accept=".p12,.pfx" aria-required="true" style={{ fontSize: 13 }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={passId} style={{ fontSize: 13, fontWeight: 600 }}>
              Passphrase <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={passId}
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-required="true"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        </div>
        <p style={{ fontSize: 11, color: "var(--mut)", marginTop: 6 }}>Maximum 10 KB. No private key material is ever displayed after upload.</p>
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            {initial ? "Replace Certificate" : "Upload Certificate"}
          </button>
          {initial && (
            <button
              type="button"
              className="btn secondary"
              style={{ minHeight: 44 }}
              disabled={busy}
              onClick={() => {
                setError(undefined);
                setDeleteConfirmOpen(true);
              }}
            >
              Remove Certificate
            </button>
          )}
        </div>
        {error && !confirmOpen && !deleteConfirmOpen && (
          <p role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
            {error}
          </p>
        )}
        {message && (
          <p role="status" aria-live="polite" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
            {message}
          </p>
        )}

        <ConfirmDialog
          open={confirmOpen}
          title="Upload this DSC certificate?"
          danger
          confirmLabel="Upload certificate"
          busy={busy}
          errorMessage={error}
          description={<>This will {initial ? "replace the existing" : "install a new"} digital signature certificate used to sign disbursement outputs for this tenant.</>}
          onConfirm={() => void upload()}
          onCancel={() => !busy && setConfirmOpen(false)}
        />

        <ConfirmDialog
          open={deleteConfirmOpen}
          title="Remove the DSC configuration?"
          danger
          confirmLabel="Remove certificate"
          busy={busy}
          errorMessage={error}
          description={<>This tenant will revert to unsigned mode until a new certificate is uploaded. This action is irreversible.</>}
          onConfirm={() => void remove()}
          onCancel={() => !busy && setDeleteConfirmOpen(false)}
        />
      </form>
    </div>
  );
}
