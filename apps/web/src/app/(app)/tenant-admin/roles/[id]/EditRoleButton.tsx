"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, Field, Input } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export function EditRoleButton({ roleId, name, description }: { roleId: string; name: string; description?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nm, setNm] = useState(name);
  const [desc, setDesc] = useState(description ?? "");
  const [nameErr, setNameErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const formError = useFormError("role");


  return (
    <>
      <Button onClick={() => { setNm(name); setDesc(description ?? ""); setError(undefined); setOpen(true); }}>
        Edit role
      </Button>
      {open && (
        <ConfirmDialog
          open={open}
          title="Edit role"
          description={
            <div style={{ display: "grid", gap: 12, marginTop: 4 }}>
              <Field label="Role name" required error={nameErr || undefined}>
                <Input value={nm} onChange={(e) => setNm(e.target.value)} />
              </Field>
              <Field label="Description">
                <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
              </Field>
            </div>
          }
          confirmLabel="Save"
          busy={busy}
          requireReason
          reasonLabel="Reason for change (audited)"
          errorMessage={error}
          onConfirm={async (reason) => {
            setNameErr("");
            if (nm.trim().length === 0) { setNameErr("Role name is required."); return; }
            setBusy(true);
            setError(undefined);
            formError.clear();
            try {
              const res = await fetch(`/api/proxy/policy/roles/${roleId}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: nm.trim(), description: desc.trim(), ...(reason ? { reason } : {}) }),
              });
              if (!res.ok) {
                setError((await formError.fromResponse(res, "save")).message);
                return;
              }
              setOpen(false);
              router.refresh();
            } catch (caught) {
              setError(formError.fromException("save", caught).message);
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
const errSty: React.CSSProperties = { color: "var(--bad)", fontSize: 12, margin: "4px 0 0" };
