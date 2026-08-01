"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type DdoResponse = { ddoCode: string; name: string; departmentIds: string[] };

export function CreateDdoForm() {
  const router = useRouter();
  const [ddoCode, setDdoCode] = useState("");
  const [name, setName] = useState("");
  const [departmentIdsRaw, setDepartmentIdsRaw] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);

  const codeField = useId();
  const nameField = useId();
  const deptField = useId();
  const errId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const codeMissing = !ddoCode.trim();
    const nameMissing = !name.trim();
    setCodeInvalid(codeMissing);
    setNameInvalid(nameMissing);
    if (codeMissing || nameMissing) {
      setError("DDO code and name are required.");
      if (codeMissing) {
        codeRef.current?.focus();
      } else {
        nameRef.current?.focus();
      }
      return;
    }
    setConfirmOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const departmentIds = departmentIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await browserJson<DdoResponse>("v1/payroll/ddos", {
        method: "POST",
        body: JSON.stringify({ ddoCode: ddoCode.trim(), name: name.trim(), departmentIds }),
      });
      setConfirmOpen(false);
      setMessage(`DDO ${res.ddoCode} — ${res.name} saved.`);
      setDdoCode("");
      setName("");
      setDepartmentIdsRaw("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm} style={{ marginBottom: 16 }}>
      <Card title="Create DDO" padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={codeField} style={{ fontSize: 13, fontWeight: 600 }}>
              DDO Code <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={codeField}
              ref={codeRef}
              value={ddoCode}
              onChange={(e) => { setDdoCode(e.target.value); setCodeInvalid(false); }}
              maxLength={32}
              aria-required="true"
              aria-invalid={codeInvalid || undefined}
              aria-describedby={codeInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={nameField} style={{ fontSize: 13, fontWeight: 600 }}>
              Name <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={nameField}
              ref={nameRef}
              value={name}
              onChange={(e) => { setName(e.target.value); setNameInvalid(false); }}
              maxLength={200}
              aria-required="true"
              aria-invalid={nameInvalid || undefined}
              aria-describedby={nameInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={deptField} style={{ fontSize: 13, fontWeight: 600 }}>Department IDs (comma-separated UUIDs)</label>
            <input id={deptField} value={departmentIdsRaw} onChange={(e) => setDepartmentIdsRaw(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            Save DDO
          </button>
        </div>
        {error && !confirmOpen && (
          <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>{error}</p>
        )}
        {message && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Save this DDO?"
        confirmLabel="Confirm save"
        busy={busy}
        errorMessage={error}
        description={
          <>
            Save DDO <strong>{ddoCode}</strong> — <strong>{name}</strong>. Existing department
            mappings for this DDO code are replaced.
          </>
        }
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
