"use client";

/**
 * GAP-HR-SHIFTS-01: create / edit shift definitions (HR roles only -- the page
 * renders this only for them, and POST/PATCH /v1/hrms/shifts re-checks the role
 * server-side). A shift edit applies going forward; it never rewrites recorded
 * attendance.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, Field, Input } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { toShiftPayload, shiftToForm, type ShiftForm, type ManagedShift } from "./shiftForm";

export function ShiftManager({ shifts }: { shifts: ManagedShift[] }) {
  const t = useTranslations("shifts");
  const router = useRouter();
  const [editing, setEditing] = useState<ManagedShift | "new" | null>(null);
  const [form, setForm] = useState<ShiftForm>(shiftToForm(null));
  const [busy, setBusy] = useState(false);
  const err = useFormError("shift");

  function open(target: ManagedShift | "new") {
    setForm(shiftToForm(target === "new" ? null : target));
    err.clear();
    setEditing(target);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = toShiftPayload(form);
    if (!parsed.ok) {
      err.fromException("save");
      return;
    }
    setBusy(true);
    err.clear();
    try {
      const isNew = editing === "new";
      const res = await fetch(
        isNew ? "/api/proxy/v1/hrms/shifts" : `/api/proxy/v1/hrms/shifts/${(editing as ManagedShift).id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
          body: JSON.stringify(parsed.payload),
        },
      );
      if (!res.ok) {
        await err.fromResponse(res, "save");
        return;
      }
      // 202 Accepted: the write is applied asynchronously, so the refreshed
      // list may need one more refresh to show it (same as every F3 mutation).
      setEditing(null);
      router.refresh();
    } catch (caught) {
      err.fromException("save", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t("manageTitle")} style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{t("manageTitle")}</h2>
        <Button onClick={() => open("new")}>{t("addShift")}</Button>
      </div>
      {shifts.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {shifts.map((s) => (
            <li key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
              <span style={{ flex: 1 }}>{s.name} — {s.startTime}–{s.endTime}</span>
              <Button variant="ghost" onClick={() => open(s)} aria-label={t("editShiftAria", { name: s.name })}>{t("edit")}</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={editing !== null}
        onClose={() => !busy && setEditing(null)}
        title={editing === "new" ? t("addShift") : t("editShift")}
      >
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          {err.message && (
            <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad, #b91c1c)" }}>{err.message}</p>
          )}
          <Field id="shift-name" label={t("fieldName")} error={err.fieldError("name")} required>
            <Input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field id="shift-start" label={t("fieldStart")} error={err.fieldError("startTime")} required>
            <Input type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </Field>
          <Field id="shift-end" label={t("fieldEnd")} error={err.fieldError("endTime")} required>
            <Input type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </Field>
          <Field id="shift-grace" label={t("fieldGrace")} error={err.fieldError("graceMins")}>
            <Input type="number" min={0} max={240} value={form.graceMins} onChange={(e) => setForm({ ...form, graceMins: e.target.value })} />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy}>{busy ? t("saving") : t("save")}</Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
