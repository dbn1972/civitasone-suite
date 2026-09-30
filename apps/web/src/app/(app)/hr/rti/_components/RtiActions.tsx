"use client";

/**
 * GAP-HR-RTI-04: assign/respond/appeal/close actions for one RTI request --
 * the backend routes (rti/routes.ts) have always existed; only the UI to
 * reach them was missing. Renders only the action(s) valid for the
 * request's CURRENT status (routes.ts's own from/to guards are the real
 * enforcement; this is a UX courtesy matching them 1:1, same discipline as
 * IdCardActions.tsx).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, Field, Input, Textarea } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type Props = { id: string; status: string };

function useRtiAction(path: string) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const err = useFormError("RTI request");

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    err.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/rti/requests/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await err.fromResponse(res, "save");
        return false;
      }
      setOpen(false);
      router.refresh();
      return true;
    } catch {
      err.fromException("save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { open, setOpen, busy, err, post };
}

function AssignAction({ id }: { id: string }) {
  const { open, setOpen, busy, err, post } = useRtiAction(`${id}/assign`);
  const [pioId, setPioId] = useState("");
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>Assign PIO</Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Assign a PIO">
        <form onSubmit={(e) => { e.preventDefault(); void post({ pioId }); }} style={{ display: "grid", gap: 14 }}>
          {err.message && <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--danger, #b91c1c)" }}>{err.message}</p>}
          <Field id="assign-pio" label="PIO user ID (UUID)" error={err.fieldError("pioId")} required>
            <Input required value={pioId} onChange={(e) => setPioId(e.target.value)} placeholder="e.g. the PIO's account id" />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Assigning…" : "Assign"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function RespondAction({ id }: { id: string }) {
  const { open, setOpen, busy, err, post } = useRtiAction(`${id}/respond`);
  const [responseText, setResponseText] = useState("");
  const [respondedDate, setRespondedDate] = useState("");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Respond</Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Respond to this request">
        <form onSubmit={(e) => { e.preventDefault(); void post({ responseText, respondedDate }); }} style={{ display: "grid", gap: 14 }}>
          {err.message && <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--danger, #b91c1c)" }}>{err.message}</p>}
          <Field id="respond-text" label="Response text" error={err.fieldError("responseText")} required>
            <Textarea required rows={5} value={responseText} onChange={(e) => setResponseText(e.target.value)} />
          </Field>
          <Field id="respond-date" label="Responded date" error={err.fieldError("respondedDate")} required>
            <Input type="date" required value={respondedDate} onChange={(e) => setRespondedDate(e.target.value)} />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit response"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function AppealAction({ id }: { id: string }) {
  const { open, setOpen, busy, err, post } = useRtiAction(`${id}/appeal`);
  const [appealText, setAppealText] = useState("");
  const [appealDate, setAppealDate] = useState("");
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>Record appeal</Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Record a first appeal">
        <form onSubmit={(e) => { e.preventDefault(); void post({ appealText, appealDate }); }} style={{ display: "grid", gap: 14 }}>
          {err.message && <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--danger, #b91c1c)" }}>{err.message}</p>}
          <Field id="appeal-text" label="Appeal text" error={err.fieldError("appealText")} required>
            <Textarea required rows={4} value={appealText} onChange={(e) => setAppealText(e.target.value)} />
          </Field>
          <Field id="appeal-date" label="Appeal date" error={err.fieldError("appealDate")} required>
            <Input type="date" required value={appealDate} onChange={(e) => setAppealDate(e.target.value)} />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Recording…" : "Record appeal"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function CloseAction({ id }: { id: string }) {
  const { open, setOpen, busy, err, post } = useRtiAction(`${id}/close`);
  const [closedDate, setClosedDate] = useState("");
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>Close request</Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Close this request">
        <form onSubmit={(e) => { e.preventDefault(); void post({ closedDate }); }} style={{ display: "grid", gap: 14 }}>
          {/* SEGREGATION_OF_DUTIES (403) surfaces here via the shared
              useFormError -> toHumanError "forbidden" mapping, same as
              every other 403 in this app -- see routes.ts's close handler. */}
          {err.message && <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--danger, #b91c1c)" }}>{err.message}</p>}
          <Field id="close-date" label="Closed date" error={err.fieldError("closedDate")} required>
            <Input type="date" required value={closedDate} onChange={(e) => setClosedDate(e.target.value)} />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Closing…" : "Close request"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function RtiActions({ id, status }: Props) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {status === "filed" && <AssignAction id={id} />}
      {(status === "filed" || status === "assigned") && <RespondAction id={id} />}
      {status === "responded" && <AppealAction id={id} />}
      {(status === "responded" || status === "appealed") && <CloseAction id={id} />}
      {status === "closed" && <span style={{ fontSize: 13, color: "var(--muted)" }}>No further action -- request is closed.</span>}
    </div>
  );
}
