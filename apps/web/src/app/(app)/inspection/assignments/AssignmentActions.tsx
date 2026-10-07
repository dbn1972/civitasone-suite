"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { useFormError } from "@/lib/useFormError";
import { todayIST } from "@/lib/formatters";
import { EntityPicker } from "@/app/_components/ds";
import { searchDirectoryUsers, resolveDirectoryUsers } from "@/lib/directory/searchUsers";
import {
  searchInspections,
  resolveInspections,
  searchInspectionTypes,
  resolveInspectionTypes,
  searchInspectionEntities,
  resolveInspectionEntities,
} from "@/lib/entityAdapters/inspectionAssign";

/**
 * GAP-INSPECTION-ASSIGNMENTS-01: the four ids were raw "UUID" text boxes,
 * practically unusable for a field officer and trivially mis-typed. They are
 * now EntityPickers over EXISTING inspection-service read endpoints
 * (GET /v1/inspection/inspections, /types, /entities — the inspection-service
 * is present in this worktree) plus the shared user directory for inspectors
 * (lib/directory/searchUsers.ts, agent A's capability — reused, not rebuilt).
 * Each picker shows a human label and yields a REAL uuid; the SAME zod UUID
 * schema the route enforces (assignment/routes.ts assignInspectorSchema) still
 * gates submit as defence in depth, and the server's clerk-safe message is
 * surfaced on failure.
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

const FIELD_LABELS: Record<Exclude<FieldName, "scheduledDate">, string> = {
  inspectionId: "Inspection",
  inspectorId: "Inspector",
  inspectionTypeId: "Inspection type",
  entityId: "Entity",
};

export function AssignmentActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [inspectionTypeId, setInspectionTypeId] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  // GAP-INSPECTION-ASSIGNMENTS-03: default to the IST calendar date, not the
  // UTC date (new Date().toISOString() is yesterday between 00:00–05:30 IST).
  const [scheduledDate, setScheduledDate] = useState(() => todayIST());
  const formError = useFormError("assignment");

  const values: Record<FieldName, string> = {
    inspectionId: inspectionId ?? "",
    inspectorId: inspectorId ?? "",
    inspectionTypeId: inspectionTypeId ?? "",
    entityId: entityId ?? "",
    scheduledDate,
  };

  async function createAssignment() {
    setError(undefined);
    setMessage("");
    const parsed = assignmentSchema.safeParse(values);
    if (!parsed.success) {
      // GAP-INSPECTION-ASSIGNMENTS-01/02: block the request and show per-field
      // errors; no fetch is made until every picker has a selection.
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldName | undefined;
        if (key && !next[key]) next[key] = "Select a value.";
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
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  function pickerField(
    name: Exclude<FieldName, "scheduledDate">,
    value: string | null,
    onChange: (v: string | null) => void,
    search: (q: string, signal: AbortSignal) => Promise<{ id: string; label: string; sublabel?: string }[]>,
    resolve: (ids: string[]) => Promise<{ id: string; label: string; sublabel?: string }[]>,
    placeholder: string,
  ) {
    const err = fieldErrors[name];
    const errId = `assignment-${name}-error`;
    return (
      <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2, minWidth: 220 }}>
        {FIELD_LABELS[name]}
        <EntityPicker
          value={value}
          onChange={(v) => onChange(Array.isArray(v) ? (v[0] ?? null) : v)}
          search={search}
          resolve={resolve}
          disabled={busy}
          minQueryLength={1}
          aria-label={FIELD_LABELS[name]}
          placeholder={placeholder}
        />
        {err ? (
          <span id={errId} role="alert" style={{ color: "var(--bad)", fontSize: 11 }}>
            {err}
          </span>
        ) : null}
      </label>
    );
  }

  const dateErr = fieldErrors.scheduledDate;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void createAssignment();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "start" }}>
        {pickerField("inspectionId", inspectionId, setInspectionId, searchInspections, resolveInspections, "Search inspection…")}
        {pickerField("inspectorId", inspectorId, setInspectorId, searchDirectoryUsers, resolveDirectoryUsers, "Search inspector by name…")}
        {pickerField("inspectionTypeId", inspectionTypeId, setInspectionTypeId, searchInspectionTypes, resolveInspectionTypes, "Search type…")}
        {pickerField("entityId", entityId, setEntityId, searchInspectionEntities, resolveInspectionEntities, "Search entity…")}
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
          Scheduled
          <input
            className="inp"
            type="date"
            value={scheduledDate}
            min={todayIST()}
            onChange={(e) => setScheduledDate(e.target.value)}
            aria-invalid={dateErr ? true : undefined}
            aria-describedby={dateErr ? "assignment-scheduledDate-error" : undefined}
          />
          {dateErr ? (
            <span id="assignment-scheduledDate-error" role="alert" style={{ color: "var(--bad)", fontSize: 11 }}>
              {dateErr}
            </span>
          ) : null}
        </label>
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
