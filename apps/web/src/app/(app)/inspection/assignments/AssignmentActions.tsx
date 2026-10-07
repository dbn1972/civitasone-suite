"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { useFormError } from "@/lib/useFormError";
import { todayIST } from "@/lib/formatters";

/**
 * GAP-INSPECTION-ASSIGNMENTS-01/02: the four ids are still typed (there is no
 * backend search/lookup endpoint for inspections, inspection types, inspectors
 * or entities in inspection-service, and resolving inspector/entity names is a
 * cross-service concern — see the batch file + HUMAN REVIEW note), but the form
 * now validates them client-side with the SAME zod UUID rules the route
 * enforces (assignment/routes.ts assignInspectorSchema), blocks submit until
 * every field is a valid UUID, shows per-field errors, and surfaces the
 * server's own message on failure instead of discarding it.
 */
const uuid = z.string().uuid();
const assignmentSchema = z.object({
  inspectionId: uuid,
  inspectorId: uuid,
  inspectionTypeId: uuid,
  entityId: uuid,
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type FieldName = keyof z.infer<typeof assignmentSchema>;

const FIELD_LABELS: Record<FieldName, string> = {
  inspectionId: "Inspection ID",
  inspectorId: "Inspector ID",
  inspectionTypeId: "Type ID",
  entityId: "Entity ID",
  scheduledDate: "Scheduled",
};

export function AssignmentActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [inspectionId, setInspectionId] = useState("");
  const [inspectorId, setInspectorId] = useState("");
  const [inspectionTypeId, setInspectionTypeId] = useState("");
  const [entityId, setEntityId] = useState("");
  // GAP-INSPECTION-ASSIGNMENTS-03: default to the IST calendar date, not the
  // UTC date (new Date().toISOString() is yesterday between 00:00–05:30 IST).
  const [scheduledDate, setScheduledDate] = useState(() => todayIST());
  const formError = useFormError("assignment");

  const values: Record<FieldName, string> = {
    inspectionId: inspectionId.trim(),
    inspectorId: inspectorId.trim(),
    inspectionTypeId: inspectionTypeId.trim(),
    entityId: entityId.trim(),
    scheduledDate,
  };

  async function createAssignment() {
    setError(undefined);
    setMessage("");
    const parsed = assignmentSchema.safeParse(values);
    if (!parsed.success) {
      // GAP-INSPECTION-ASSIGNMENTS-02: block the request and show per-field
      // errors; no fetch is made for a blank/invalid form.
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldName | undefined;
        if (key && !next[key]) next[key] = "Enter a valid value.";
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/inspection/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.status !== 202 && !res.ok) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      // GAP-INSPECTION-ASSIGNMENTS-05: assignment creation is async (202); be
      // honest that the row appears shortly and offer a refresh.
      setMessage("Assignment request accepted. It will appear in the list shortly — use Refresh in a few seconds.");
      router.refresh();
    } catch (caught) {
      // GAP-INSPECTION-ASSIGNMENTS-02: surface the server's own clerk-safe
      // message (built by fromResponse) rather than discarding it.
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  function field(name: FieldName, state: string, set: (v: string) => void, type = "text") {
    const err = fieldErrors[name];
    const errId = `assignment-${name}-error`;
    return (
      <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
        {FIELD_LABELS[name]}
        <input
          className="inp"
          type={type}
          value={state}
          onChange={(e) => set(e.target.value)}
          placeholder={type === "date" ? undefined : "UUID"}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? errId : undefined}
          {...(type === "date" ? { min: todayIST() } : {})}
        />
        {err ? (
          <span id={errId} role="alert" style={{ color: "var(--bad)", fontSize: 11 }}>
            {err}
          </span>
        ) : null}
      </label>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void createAssignment();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "start" }}>
        {field("inspectionId", inspectionId, setInspectionId)}
        {field("inspectorId", inspectorId, setInspectorId)}
        {field("inspectionTypeId", inspectionTypeId, setInspectionTypeId)}
        {field("entityId", entityId, setEntityId)}
        {field("scheduledDate", scheduledDate, setScheduledDate, "date")}
        <button type="submit" className="btn" disabled={busy}>
          Create assignment
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => router.refresh()}>
          Refresh
        </button>
      </div>
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
