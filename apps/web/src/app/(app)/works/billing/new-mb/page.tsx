"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

type MbForm = {
  workId: string;
  awardId: string;
  mbNumber: string;
};

function NewMbForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [form, setForm] = useState<MbForm>({
    workId: searchParams.get("workId") ?? "",
    awardId: searchParams.get("awardId") ?? "",
    mbNumber: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function set(field: keyof MbForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/works/billing/mb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId: form.workId,
          awardId: form.awardId,
          mbNumber: form.mbNumber,
        }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? "Create failed");
      setMessage("Created.");
      toast.success("Measurement book issued.");
      setTimeout(() => router.push(form.workId.trim() ? `/works/billing/${form.workId.trim()}` : "/works/billing"), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Issue Measurement Book"
        subtitle="Create a new measurement book entry."
        back={form.workId.trim() ? `/works/billing/${form.workId.trim()}` : "/works/billing"}
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
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle}>Work ID (UUID) *</label>
              <input
                type="text"
                required
                value={form.workId}
                onChange={set("workId")}
                style={inputStyle}
                placeholder="UUID of the work"
              />
            </div>

            <div>
              <label style={labelStyle}>Award ID (UUID) *</label>
              <input
                type="text"
                required
                value={form.awardId}
                onChange={set("awardId")}
                style={inputStyle}
                placeholder="UUID of the award"
              />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                Find in Works Tenders list
              </p>
            </div>

            <div>
              <label style={labelStyle}>MB Number *</label>
              <input
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

          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {busy ? "Submitting..." : "Submit"}
          </button>
        </form>
      </div>
    </>
  );
}

export default function NewMbPage() {
  return (
    <Suspense>
      <NewMbForm />
    </Suspense>
  );
}
