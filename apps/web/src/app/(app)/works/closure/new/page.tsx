"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { z } from "zod";
import { humanZodMessage } from "@/lib/humanZodMessage";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, Field, Select, Textarea, EntityPicker, ConfirmDialog, SkeletonCard } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { searchWorkProposals, resolveWorkProposals } from "@/lib/entityAdapters/workProposal";


const okBanner: React.CSSProperties = { background: "var(--good-bg, #ecfdf3)", color: "var(--good, #166534)", padding: 12, borderRadius: 12, fontSize: 13, marginBottom: 16 };
const errBanner: React.CSSProperties = { background: "var(--bad-bg, #fef2f2)", color: "var(--bad, #b42318)", padding: 12, borderRadius: 12, fontSize: 13, marginBottom: 16 };

// GAP-WORKS-CLOSURE-01: closureType mirrors the backend closeWorkSchema enum
// exactly (execution/validators.ts). closedDate is NOT part of that contract,
// so the form does not collect or fabricate one — the service stamps the
// closed date itself.
const CLOSURE_TYPES = [
  { value: "closed", label: "Closed (work finished / no longer active)" },
  { value: "dropped", label: "Dropped (abandoned before completion)" },
  { value: "completion", label: "Completion list (physically complete)" },
] as const;

const closureFormSchema = z.object({
  workId: z.string().uuid({ message: "Choose a work." }),
  closureType: z.enum(["closed", "dropped", "completion"]),
  remarks: z.string().max(2048).optional(),
});

function NewClosureForm() {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const prefilledWorkId = searchParams.get("workId") ?? "";
  const [form, setForm] = useState({ workId: prefilledWorkId, closureType: "closed", remarks: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formError = useFormError("work closure");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const parsed = closureFormSchema.safeParse({
      workId: form.workId.trim(),
      closureType: form.closureType,
      remarks: form.remarks.trim() || undefined,
    });
    if (!parsed.success) {
      setError(humanZodMessage(parsed.error.issues[0]));
      return;
    }
    // Closing/dropping/completing a work is an authority-gated, audited state
    // change — require an explicit confirmation before the POST.
    setConfirmOpen(true);
  }

  async function doClose() {
    setBusy(true);
    setError("");
    formError.clear();
    try {
      const body: Record<string, string> = {
        workId: form.workId.trim(),
        closureType: form.closureType,
      };
      if (form.remarks.trim()) body.remarks = form.remarks.trim();

      const res = await fetch("/api/proxy/v1/works/execution/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setConfirmOpen(false);
        // The backend returns 422 CLOSURE_NOT_ELIGIBLE / 409 SPLITS_NOT_CLOSED
        // with a clerk-safe message — surface it via the catalogued copy.
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setConfirmOpen(false);
      setMessage("Closure submitted. It will appear in the register once processed.");
      toast.success("Closure submitted.");
      setTimeout(() => router.push("/works/closure"), 700);
    } catch (caught) {
      setConfirmOpen(false);
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const typeLabel = CLOSURE_TYPES.find((t) => t.value === form.closureType)?.label ?? form.closureType;

  return (
    <>
      <PageHeader title="New Closure" subtitle="Close, drop, or mark a work complete." back="/works/closure" backLabel="Closure" />
      {message ? <div role="status" aria-live="polite" style={okBanner}>{message}</div> : null}
      {error ? <div role="alert" aria-live="assertive" style={errBanner}>{error}</div> : null}
      <div className="card">
        <form onSubmit={onSubmit} className="pad" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>

          <Field label="Work *" id="closure-workId">
            <EntityPicker
              id="closure-workId"
              value={form.workId || null}
              onChange={(v) => setForm((prev) => ({ ...prev, workId: Array.isArray(v) ? v[0] ?? "" : v ?? "" }))}
              search={searchWorkProposals}
              resolve={resolveWorkProposals}
              disabled={prefilledWorkId.length > 0}
              placeholder="Search by work number or description…"
              aria-label="Work"
            />
          </Field>

          <Field label="Closure type *" id="closure-type">
            <Select
              id="closure-type"
              value={form.closureType}
              onChange={(e) => setForm((prev) => ({ ...prev, closureType: e.target.value }))}
            >
              {CLOSURE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Remarks" id="closure-remarks">
            <Textarea
              id="closure-remarks"
              style={{ minHeight: 80 }}
              value={form.remarks}
              onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
              maxLength={2048}
              placeholder="Optional reason / notes"
            />
          </Field>

          <div style={{ display: "flex", gap: 12 }}>
            <Button type="submit" variant="primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Submitting…" : "Submit closure"}
            </Button>
            <Button variant="ghost" onClick={() => router.push("/works/closure")} disabled={busy} style={{ minHeight: 44 }}>
              Cancel
            </Button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm work closure"
        description={`Submit a '${typeLabel}' closure for this work? This is an audited state change and may require closing all splits first.`}
        confirmLabel="Submit closure"
        busy={busy}
        onConfirm={doClose}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

export default function NewClosurePage() {
  return (
    <Suspense fallback={<SkeletonCard />}>
      <NewClosureForm />
    </Suspense>
  );
}
