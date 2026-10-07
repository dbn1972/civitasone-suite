"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, SkeletonCard } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

/** GAP-WORKS-BILLING-NEW-MB-02: one source of truth for the success copy so the
 * inline banner and the toast cannot drift ("Created." vs "issued."). */
const SUCCESS_MESSAGE = "Measurement book issued.";

type Option = { id: string; label: string };

type MbForm = {
  workId: string;
  awardId: string;
  mbNumber: string;
};

function NewMbForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // GAP-WORKS-BILLING-NEW-MB-04: the back/cancel target is derived from the
  // STABLE search param, not the live Work ID field — so typing in the field
  // can't repoint the back link mid-keystroke.
  const paramWorkId = (searchParams.get("workId") ?? "").trim();
  const backHref = paramWorkId ? `/works/billing/${paramWorkId}` : "/works/billing";

  const [form, setForm] = useState<MbForm>({
    workId: paramWorkId,
    awardId: searchParams.get("awardId") ?? "",
    mbNumber: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("measurement book");

  // GAP-WORKS-BILLING-NEW-MB-01: when the work is known, fetch its awards so
  // the clerk SELECTS the award instead of pasting a UUID the Tenders list
  // never exposed. Falls back to a guarded text input otherwise.
  const [awards, setAwards] = useState<Option[] | null>(null);
  useEffect(() => {
    if (!paramWorkId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/works/billing/${paramWorkId}/awards`);
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { data?: unknown };
        const rows = Array.isArray(body.data) ? body.data : [];
        setAwards(
          rows.map((r) => {
            const row = r as Record<string, unknown>;
            const agreement = row.agreementNumber ? String(row.agreementNumber) : null;
            const id = String(row.id ?? "");
            return { id, label: agreement ? `${agreement} — ${String(row.contractorName ?? "")}` : id };
          }),
        );
      } catch {
        /* leave null → guarded text input */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramWorkId]);

  function set(field: keyof MbForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    formError.clear();
    try {
      // GAP-WORKS-BILLING-NEW-MB-03: trim all values before sending (as
      // bills/new does) so stray whitespace can't defeat uniqueness/UUID
      // validation server-side.
      const res = await fetch("/api/proxy/v1/works/billing/mb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId: form.workId.trim(),
          awardId: form.awardId.trim(),
          mbNumber: form.mbNumber.trim(),
        }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage(SUCCESS_MESSAGE);
      toast.success(SUCCESS_MESSAGE);
      const target = form.workId.trim() ? `/works/billing/${form.workId.trim()}` : "/works/billing";
      setTimeout(() => router.push(target), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Issue Measurement Book"
        subtitle="Create a new measurement book entry."
        back={backHref}
        backLabel="Billing"
      />
      {message ? (
        <div role="status" aria-live="polite" style={okBanner}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" style={errBanner}>
          {error}
        </div>
      ) : null}
      <div className="card">
        <form
          onSubmit={submit}
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            Fields marked * are required. Open a work from the Billing register to have the
            Work and Award chosen for you.
          </p>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div>
              <label htmlFor="new-mb-work-id" style={labelStyle}>Work ID (UUID) *</label>
              <input
                id="new-mb-work-id"
                type="text"
                required
                value={form.workId}
                onChange={set("workId")}
                style={inputStyle}
                placeholder="UUID of the work"
                readOnly={!!paramWorkId}
              />
            </div>

            <div>
              <label htmlFor="new-mb-award-id" style={labelStyle}>Award *</label>
              {awards && awards.length > 0 ? (
                <select id="new-mb-award-id" style={inputStyle} required value={form.awardId} onChange={set("awardId")}>
                  <option value="">Select an award…</option>
                  {awards.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    id="new-mb-award-id"
                    type="text"
                    required
                    value={form.awardId}
                    onChange={set("awardId")}
                    style={inputStyle}
                    placeholder="UUID of the award"
                  />
                  <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    Open this work from the Billing register to pick the award.
                  </p>
                </>
              )}
            </div>

            <div>
              <label htmlFor="new-mb-number" style={labelStyle}>MB Number *</label>
              <input
                id="new-mb-number"
                type="text"
                required
                maxLength={64}
                value={form.mbNumber}
                onChange={set("mbNumber")}
                style={inputStyle}
                placeholder="e.g. MB/2024-25/001"
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4 }}>
            <Button
              variant="ghost"
              onClick={() => router.push(backHref)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              style={{ minHeight: 44 }}
            >
              {busy ? "Submitting..." : "Submit"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function NewMbPage() {
  // GAP-WORKS-BILLING-NEW-MB-04: visible Suspense fallback.
  return (
    <Suspense fallback={<SkeletonCard />}>
      <NewMbForm />
    </Suspense>
  );
}
