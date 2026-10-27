"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

/**
 * Owner decision #4: record that a demand notice was served. A recovery
 * referral is allowed only after a served notice's period has lapsed. The
 * notice period defaults to the tenant default (15 days unless configured); an
 * officer may only lengthen it (owner decision F1) and the server enforces the
 * same floor.
 */
export function ServeNoticeForm({ assesseeId, defaultNoticePeriodDays = 15 }: { assesseeId: string; defaultNoticePeriodDays?: number }) {
  const router = useRouter();
  const [noticeNo, setNoticeNo] = useState("");
  const [servedOn, setServedOn] = useState("");
  const [days, setDays] = useState(String(defaultNoticePeriodDays));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [errors, setErrors] = useState<{ noticeNo?: string; servedOn?: string; days?: string }>({});

  const noId = useId();
  const dateId = useId();
  const daysId = useId();
  const noRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const next: typeof errors = {};
    if (!noticeNo.trim()) next.noticeNo = "Enter the demand notice number.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(servedOn)) next.servedOn = "Enter the date the notice was served.";
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) next.days = "Enter the notice period in days (1 to 365).";
    else if (n < defaultNoticePeriodDays) next.days = `The notice period cannot be shorter than the default of ${defaultNoticePeriodDays} days; you can only lengthen it.`;
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      noRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await browserJson("v1/revenue/demand-notices", {
        method: "POST",
        body: JSON.stringify({ assesseeId, noticeNo: noticeNo.trim(), servedOn, noticePeriodDays: n }),
      });
      setTone("good");
      setMessage("Demand notice recorded. A recovery referral becomes possible once its notice period has lapsed.");
      setNoticeNo("");
      setServedOn("");
      setDays(String(defaultNoticePeriodDays));
      router.refresh();
    } catch (err) {
      setTone("bad");
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

  return (
    <form noValidate onSubmit={(e) => void handleSubmit(e)} style={{ marginBottom: 16 }} aria-label="Record a served demand notice">
      <Card title="Record served demand notice" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={noId} style={{ fontSize: 13, fontWeight: 600 }}>Notice number *</label>
              <input id={noId} ref={noRef} value={noticeNo} onChange={(e) => setNoticeNo(e.target.value)} maxLength={64} aria-required="true" aria-invalid={!!errors.noticeNo || undefined} style={field} />
              {errors.noticeNo && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>{errors.noticeNo}</p>}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>Served on *</label>
              <input id={dateId} type="date" value={servedOn} onChange={(e) => setServedOn(e.target.value)} aria-required="true" aria-invalid={!!errors.servedOn || undefined} style={field} />
              {errors.servedOn && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>{errors.servedOn}</p>}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={daysId} style={{ fontSize: 13, fontWeight: 600 }}>Notice period (days) *</label>
              <input id={daysId} type="number" min={defaultNoticePeriodDays} max={365} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-required="true" aria-invalid={!!errors.days || undefined} style={field} />
              {errors.days && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>{errors.days}</p>}
            </div>
          </div>
          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              Record served notice
            </Button>
          </div>
          {message && (
            <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>
    </form>
  );
}
