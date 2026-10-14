"use client";

/**
 * AddTaskForm — lets HR add a single onboarding task to an employee who has
 * none yet.
 *
 * GAP-HR-ONBOARDING-02 (fix step 1 of this catalog item; see this PR's
 * description for which step is deferred and why): onboarding could not be
 * started from the UI at all -- '+ Add New Joinee' only creates a new
 * employee record, and no screen ever called the existing
 * POST /v1/hrms/employees/:id/onboarding-tasks. This form calls that
 * existing endpoint directly; it does not add any new backend surface of
 * its own.
 */

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { AcceptedNotice, Field, Input } from "@/app/_components/ds";
import { validateAddTask } from "./addTaskSchema";
import { translateFormErrors } from "../../_components/translateFormErrors";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";

interface AddTaskFormProps {
  employeeId: string;
}

export function AddTaskForm({ employeeId }: AddTaskFormProps) {
  const accepted = useAcceptedWrite();
  const tv = useTranslations("hrFormErrors");
  const [title, setTitle] = useState("");
  const [dueByDay, setDueByDay] = useState("7");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [touched, setTouched] = useState<{ title?: boolean; dueByDay?: boolean }>({});
  const formError = useFormError("onboarding task");
  const clientErrors = translateFormErrors(validateAddTask({ title, dueByDay }), tv);
  /** Client message once the field has been edited, then a backend rejection for the same field. */
  const errFor = (f: "title" | "dueByDay") => (touched[f] ? clientErrors[f] : undefined) ?? formError.fieldError(f);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(clientErrors).length > 0) {
      setTouched({ title: true, dueByDay: true });
      return;
    }
    setSubmitting(true);
    setSuccess(false);
    setLocalError(null);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/onboarding-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueByDay: Number(dueByDay) }),
      });
      if (!res.ok) {
        setLocalError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setTitle("");
      setDueByDay("7");
      setSuccess(true);
      // Async write (F3 queue, same as every other mutation in this module)
      // -- refresh shortly after so the new task actually shows up.
      void accepted.accept();
    } catch (caught) {
      setLocalError(formError.fromException("save", caught).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Object.keys(clientErrors).length === 0;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ marginTop: 16, textAlign: "left", maxWidth: 360, marginInline: "auto" }}>
      <AcceptedNotice {...accepted.noticeProps} />
      <Field label="Task title" required error={errFor("title")} style={{ marginBottom: 10 }}>
        <Input
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setTouched((p) => ({ ...p, title: true })); }}
          maxLength={200}
          placeholder="e.g. Collect department ID badge"
        />
      </Field>
      <Field label="Due (days from joining)" required error={errFor("dueByDay")} style={{ marginBottom: 10 }}>
        <Input
          type="number"
          min={1}
          max={365}
          value={dueByDay}
          onChange={(e) => { setDueByDay(e.target.value); setTouched((p) => ({ ...p, dueByDay: true })); }}
          style={{ width: 100 }}
        />
      </Field>
      <button type="submit" className="btn primary" disabled={!canSubmit || submitting} style={{ fontSize: 13 }}>
        {submitting ? "Adding…" : "Add task"}
      </button>
      {success && (
        <p role="status" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--good, #067647)", fontWeight: 500 }}>
          Task added.
        </p>
      )}
      {localError && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--bad, #dc2626)", fontWeight: 500 }}>
          {localError}
        </p>
      )}
    </form>
  );
}
