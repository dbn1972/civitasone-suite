"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

export function RecordHearingForm({ complaintId }: { complaintId: string }) {
  const router = useRouter();
  const [hearingDate, setHearingDate] = useState("");
  const [notes, setNotes] = useState("");
  const [finding, setFinding] = useState("");
  const [busy, setBusy] = useState(false);
  const err = useFormError("hearing");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    err.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/icc/complaints/${complaintId}/hearings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hearingDate,
          ...(notes ? { notes } : {}),
          ...(finding ? { finding } : {}),
        }),
      });
      if (!res.ok) {
        await err.fromResponse(res, "save");
        return;
      }
      setHearingDate("");
      setNotes("");
      setFinding("");
      router.refresh();
    } catch (caught) {
      err.fromException("save", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 480 }}>
      {err.message && <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--danger, #b91c1c)" }}>{err.message}</p>}
      <Field id="hearing-date" label="Hearing date" error={err.fieldError("hearingDate")} required>
        <Input type="date" required value={hearingDate} onChange={(e) => setHearingDate(e.target.value)} />
      </Field>
      <Field id="hearing-notes" label="Notes (optional)" error={err.fieldError("notes")}>
        <Textarea rows={4} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Field id="hearing-finding" label="Finding (optional)" error={err.fieldError("finding")}>
        <Input maxLength={24} value={finding} onChange={(e) => setFinding(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy}>{busy ? "Recording…" : "Record hearing"}</Button>
    </form>
  );
}
