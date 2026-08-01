"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id: string; status: string; correlationId?: string };

export function CreateStructureForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const nameId = useId();
  const descId = useId();
  const defaultId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!name.trim()) {
      setTone("bad");
      setMessage("Structure name is required.");
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createStructure() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/payroll/structures", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          isDefault,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Structure submitted (id ${res.id}). It is processed asynchronously and will appear in the list shortly.`
          : "Structure submitted.",
      );
      setName("");
      setDescription("");
      setIsDefault(false);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Create Pay Structure</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>Name</label>
            <input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={descId} style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
            <input
              id={descId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
            <input
              id={defaultId}
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <label htmlFor={defaultId} style={{ fontSize: 13, fontWeight: 600 }}>Set as default structure</label>
          </div>
        </div>

        <div>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            Create Structure
          </button>
        </div>

        {message && (
          <p role="status" aria-live="polite" className={`pill ${tone}`} style={{ width: "fit-content" }}>
            {message}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this pay structure?"
        confirmLabel="Create structure"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create pay structure <strong>{name}</strong>
            {isDefault ? " and set it as the default structure" : ""}.
          </>
        }
        onConfirm={() => void createStructure()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
