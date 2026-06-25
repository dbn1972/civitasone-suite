"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";

export function EditRoleButton({ roleId, name, description }: { roleId: string; name: string; description?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nm, setNm] = useState(name);
  const [desc, setDesc] = useState(description ?? "");
  const [nameErr, setNameErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const nameId = useId();
  const descId = useId();

  return (
    <>
      <button type="button" className="btn primary" onClick={() => { setNm(name); setDesc(description ?? ""); setError(undefined); setOpen(true); }}>
        Edit role
      </button>
      {open && (
        <ConfirmDialog
          open={open}
          title="Edit role"
          description={
            <div style={{ display: "grid", gap: 12, marginTop: 4 }}>
              <div>
                <label htmlFor={nameId} style={lbl}>Role name</label>
                <input id={nameId} value={nm} onChange={(e) => setNm(e.target.value)}
                  aria-invalid={nameErr ? true : undefined} style={inp} />
                {nameErr ? <p role="alert" style={errSty}>{nameErr}</p> : null}
              </div>
              <div>
                <label htmlFor={descId} style={lbl}>Description</label>
                <input id={descId} value={desc} onChange={(e) => setDesc(e.target.value)} style={inp} />
              </div>
            </div>
          }
          confirmLabel="Save"
          busy={busy}
          errorMessage={error}
          onConfirm={async () => {
            setNameErr("");
            if (nm.trim().length === 0) { setNameErr("Role name is required."); return; }
            setBusy(true);
            setError(undefined);
            try {
              const res = await fetch(`/api/proxy/policy/roles/${roleId}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: nm.trim(), description: desc.trim() }),
              });
              if (!res.ok) {
                const text = await res.text();
                let msg = text || `Request failed (${res.status})`;
                try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* */ }
                throw new Error(msg);
              }
              setOpen(false);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to update role.");
            } finally {
              setBusy(false);
            }
          }}
          onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
        />
      )}
    </>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit", color: "var(--ink)" };
const errSty: React.CSSProperties = { color: "#b42318", fontSize: 12, margin: "4px 0 0" };
