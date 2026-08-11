"use client";

import { useId, useState } from "react";

interface Props {
  onCancel: () => void;
  onSuccess?: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 10,
  background: "#fff",
  color: "#0f172a",
  minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f172a",
};

export function AddDepartmentForm({ onCancel, onSuccess }: Props) {
  const formId = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const codeId = `${formId}-code`;
  const nameId = `${formId}-name`;
  const statusId = `${formId}-status`;

  function handleCancel() {
    setCode("");
    setName("");
    setMessage(null);
    setInvalid(new Set());
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const trimCode = code.trim();
    const trimName = name.trim();
    const errs = new Set<string>();

    if (!trimCode || trimCode.length > 20) errs.add("code");
    if (trimName.length < 2 || trimName.length > 200) errs.add("name");

    if (errs.size > 0) {
      setInvalid(errs);
      setTone("error");
      setMessage("Please fix the highlighted fields.");
      return;
    }

    setInvalid(new Set());
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/hrms/departments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: trimCode, name: trimName }),
      });

      if (!res.ok) {
        let detail = "";
        try {
          const json: unknown = await res.json();
          if (
            typeof json === "object" &&
            json !== null &&
            "message" in json
          ) {
            detail = String((json as Record<string, unknown>).message);
          }
        } catch {
          // ignore
        }
        throw new Error(detail || `Failed (${res.status})`);
      }

      setTone("success");
      setMessage(`Department "${trimName}" added successfully.`);
      setCode("");
      setName("");
      onSuccess?.();
    } catch (err) {
      setTone("error");
      setMessage(
        err instanceof Error ? err.message : "Network error. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label="Add department"
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>Add Department</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {/* Status region */}
        <div aria-live="polite" aria-atomic="true" id={statusId}>
          {message && (
            <p
              role={tone === "error" ? "alert" : "status"}
              style={{
                margin: 0,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                background: tone === "success" ? "#dcfce7" : "#fee2e2",
                border: `1px solid ${
                  tone === "success" ? "#86efac" : "#fca5a5"
                }`,
                color: tone === "success" ? "#166534" : "#b91c1c",
              }}
            >
              {tone === "success" ? "✅" : "⚠️"} {message}
            </p>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          {/* Code */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={codeId} style={labelStyle}>
              Code{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
                *
              </span>
            </label>
            <input
              id={codeId}
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. FIN"
              maxLength={20}
              required
              aria-required="true"
              aria-invalid={invalid.has("code")}
              style={inputStyle}
            />
          </div>

          {/* Name */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={nameId} style={labelStyle}>
              Name{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
                *
              </span>
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Finance Department"
              maxLength={200}
              required
              aria-required="true"
              aria-invalid={invalid.has("name")}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            aria-busy={busy}
            style={{ minHeight: 44, minWidth: 140 }}
          >
            {busy ? "Adding…" : "Add Department"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleCancel}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
