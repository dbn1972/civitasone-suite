"use client";

/**
 * GAP-HR-RTI-04: the register's own subtitle names a CPIO workflow ("30-day
 * SLA tracking and CPIO response workflow"), but the page had no filing
 * action at all -- the backend's POST /v1/hrms/rti/requests has always
 * existed (fileRtiBody, rti/validators.ts). Modal form mirrors that schema.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, Field, Input, Textarea } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

export function FileRtiAction() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [referenceNo, setReferenceNo] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [subject, setSubject] = useState("");
  const [requestText, setRequestText] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [slaDays, setSlaDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const err = useFormError("RTI request");

  function reset() {
    setReferenceNo("");
    setApplicantName("");
    setSubject("");
    setRequestText("");
    setReceivedDate("");
    setSlaDays("30");
    err.clear();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    err.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/rti/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          referenceNo,
          applicantName,
          subject,
          requestText,
          receivedDate,
          slaDays: Number(slaDays) || 30,
        }),
      });
      if (!res.ok) {
        await err.fromResponse(res, "save");
        return;
      }
      // 202 Accepted -- the write is eventual (F3/outbox), so the new row
      // isn't guaranteed to be there on the very next read. router.refresh()
      // re-runs the server page; if the consumer hasn't landed yet, the
      // filed request simply appears on the next refresh, same as every
      // other 202-accepted mutation in this app (e.g. LocationActions.tsx).
      setOpen(false);
      reset();
      router.refresh();
    } catch (caught) {
      err.fromException("save", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>File RTI request</Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="File a new RTI request" size="lg">
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          {err.message && (
            <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--danger, #b91c1c)" }}>
              {err.message}
            </p>
          )}
          <Field id="rti-ref" label="Reference number" error={err.fieldError("referenceNo")} required>
            <Input required value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} maxLength={64} />
          </Field>
          <Field id="rti-applicant" label="Applicant name" error={err.fieldError("applicantName")} required>
            <Input required value={applicantName} onChange={(e) => setApplicantName(e.target.value)} maxLength={256} />
          </Field>
          <Field id="rti-subject" label="Subject" error={err.fieldError("subject")} required>
            <Input required value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={512} />
          </Field>
          <Field id="rti-request-text" label="Request text" error={err.fieldError("requestText")} required>
            <Textarea required value={requestText} onChange={(e) => setRequestText(e.target.value)} rows={4} />
          </Field>
          <Field id="rti-received" label="Received date" error={err.fieldError("receivedDate")} required>
            <Input type="date" required value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </Field>
          <Field id="rti-sla" label="SLA (days)" error={err.fieldError("slaDays")}>
            <Input type="number" min={1} max={60} value={slaDays} onChange={(e) => setSlaDays(e.target.value)} />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Filing…" : "File request"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
