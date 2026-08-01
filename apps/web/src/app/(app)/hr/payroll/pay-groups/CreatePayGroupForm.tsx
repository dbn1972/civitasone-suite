"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type PayGroupResponse = {
  data: { id: string; name: string; frequency: string; payDayOfMonth: number; timezone: string; status: string };
};

const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "bi_weekly", label: "Bi-weekly" },
  { value: "weekly", label: "Weekly" },
] as const;

export function CreatePayGroupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "bi_weekly" | "weekly">("monthly");
  const [payDayOfMonth, setPayDayOfMonth] = useState("28");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const nameId = useId();
  const freqId = useId();
  const dayId = useId();
  const tzId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const day = parseInt(payDayOfMonth, 10);
    if (!name.trim()) {
      setTone("bad");
      setMessage("Pay group name is required.");
      return;
    }
    if (Number.isNaN(day) || day < 1 || day > 31) {
      setTone("bad");
      setMessage("Pay day must be between 1 and 31.");
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createPayGroup() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<PayGroupResponse>("v1/payroll/pay-groups", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          frequency,
          payDayOfMonth: parseInt(payDayOfMonth, 10),
          timezone: timezone.trim() || "Asia/Kolkata",
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Pay group "${res.data.name}" created.`);
      setName("");
      setPayDayOfMonth("28");
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
        <h3>Create Pay Group</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
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
            <label htmlFor={freqId} style={{ fontSize: 13, fontWeight: 600 }}>Frequency</label>
            <select
              id={freqId}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as typeof frequency)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={dayId} style={{ fontSize: 13, fontWeight: 600 }}>Pay Day of Month</label>
            <input
              id={dayId}
              type="number"
              min={1}
              max={31}
              value={payDayOfMonth}
              onChange={(e) => setPayDayOfMonth(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={tzId} style={{ fontSize: 13, fontWeight: 600 }}>Timezone</label>
            <input
              id={tzId}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              maxLength={64}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        </div>

        <div>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            Create Pay Group
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
        title="Create this pay group?"
        confirmLabel="Create pay group"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create pay group <strong>{name}</strong> ({FREQUENCIES.find((f) => f.value === frequency)?.label},
            pay day {payDayOfMonth}).
          </>
        }
        onConfirm={() => void createPayGroup()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
