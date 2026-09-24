"use client";
import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Button } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { useTranslations } from "next-intl";

export default function OvertimeNewPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const formError = useFormError("overtime request");
  const t = useTranslations("overtimeNew");

  const empId    = useId();
  const dateId   = useId();
  const hrsId    = useId();
  const reasonId = useId();

  const [employeeId, setEmployeeId]     = useState("");
  const [requestDate, setRequestDate]   = useState("");
  const [hours, setHours]               = useState("");
  const [reason, setReason]             = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/proxy/v1/hrms/overtime-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId, requestDate, hoursRequested: Number(hours),
          reason: reason || undefined,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMsg(resolved.message);
        setStatus("error");
        return;
      }
      setStatus("done");
      setMsg(t("successMessage"));
      setTimeout(() => router.push("/hr/overtime"), 1000);
    } catch {
      setMsg(formError.fromException("save").message);
      setStatus("error");
    }
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/overtime" backLabel="Back to Overtime" />
      <div style={{ maxWidth: 520, marginTop: 20 }}>
      <Card title={t("cardTitle")}>
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor={empId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("labelEmployee")}</label>
            <input id={empId} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
placeholder={t("placeholderEmployee")} required pattern="[0-9a-f-]{36}" />
            {formError.fieldError("employeeId") && (
              <p id="ot-empid-error" role="alert" style={{ color: "var(--red, #c00)", fontSize: 12, margin: "4px 0 0" }}>{formError.fieldError("employeeId")}</p>
            )}
          </div>
          <div>
<label htmlFor={dateId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("labelDate")}</label>
            <input id={dateId} type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} required aria-required="true" />
          </div>
          <div>
            <label htmlFor={hrsId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("labelHours")}</label>
            <input id={hrsId} type="number" step="0.5" min="0.5" max="24"
value={hours} onChange={(e) => setHours(e.target.value)} placeholder={t("placeholderHours")} required />
          </div>
          <div>
            <label htmlFor={reasonId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("labelReason")}</label>
            <textarea id={reasonId} rows={3} style={{ resize: "vertical" }}
              value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("placeholderReason")} />
          </div>
          {msg && (
            <p role={status === "error" ? "alert" : "status"} aria-live={status === "error" ? "assertive" : "polite"} style={{ color: status === "error" ? "var(--red, #c00)" : "var(--green, #0a0)", fontSize: 13 }}>
              {msg}
            </p>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => router.push("/hr/overtime")}>{t("cancel")}</Button>
            <Button type="submit" variant="primary" disabled={status === "submitting"}>
              {status === "submitting" ? t("submitting") : t("submitRequest")}
            </Button>
          </div>
        </form>
      </Card>
      </div>
    </main>
  );
}
