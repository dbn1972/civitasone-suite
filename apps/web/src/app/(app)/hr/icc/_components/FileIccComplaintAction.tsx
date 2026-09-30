"use client";

/**
 * GAP-HR-ICC-03: "File complaint" action -- the backend's POST
 * /v1/hrms/icc/complaints has always existed; only the UI was missing.
 * Uses EntityPicker (GAP-HR-SF-06) for complainant/respondent instead of a
 * typed UUID field, per the catalog's own fix step.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, Field, Textarea, EntityPicker } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

export function FileIccComplaintAction() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [complainantId, setComplainantId] = useState<string | null>(null);
  const [respondentId, setRespondentId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const err = useFormError("ICC complaint");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    err.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/icc/complaints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          complainantId,
          ...(respondentId ? { respondentId } : {}),
          summary,
        }),
      });
      if (!res.ok) {
        await err.fromResponse(res, "save");
        return;
      }
      setOpen(false);
      setComplainantId(null);
      setRespondentId(null);
      setSummary("");
      router.refresh();
    } catch {
      err.fromException("save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>File complaint</Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="File an ICC complaint" size="lg">
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          This filing is confidential under POSH Act 2013, §16. Only nominated ICC members can see the complainant/respondent identity.
        </p>
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          {err.message && (
            <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--danger, #b91c1c)" }}>
              {err.message}
            </p>
          )}
          <Field id="icc-complainant" label="Complainant" error={err.fieldError("complainantId")} required>
            <EntityPicker
              value={complainantId}
              onChange={(v) => setComplainantId(Array.isArray(v) ? (v[0] ?? null) : v)}
              search={searchEmployees}
              resolve={resolveEmployees}
              placeholder="Search employee by name…"
            />
          </Field>
          <Field id="icc-respondent" label="Respondent (optional)" error={err.fieldError("respondentId")}>
            <EntityPicker
              value={respondentId}
              onChange={(v) => setRespondentId(Array.isArray(v) ? (v[0] ?? null) : v)}
              search={searchEmployees}
              resolve={resolveEmployees}
              placeholder="Search employee by name…"
            />
          </Field>
          <Field id="icc-summary" label="Summary" error={err.fieldError("summary")} required>
            <Textarea required rows={5} minLength={10} maxLength={5000} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !complainantId || summary.trim().length < 10}>
              {busy ? "Filing…" : "File complaint"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
