"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Field, Input, Select, useToast } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

export type StoreOption = { id: string; name: string };

/** Mirrors inventory-service createBinBody (code 1-64, aisle/rack/shelf <=16, capacity positive int). */
export const newBinSchema = z.object({
  storeId: z.string().uuid("Choose a store."),
  code: z.string().trim().min(1, "Bin code is required.").max(64, "Must be at most 64 characters."),
  aisle: z.string().trim().max(16, "Must be at most 16 characters."),
  rack: z.string().trim().max(16, "Must be at most 16 characters."),
  shelf: z.string().trim().max(16, "Must be at most 16 characters."),
  capacity: z.string().trim().refine((v) => v === "" || /^[1-9]\d*$/.test(v), "Enter a whole number of 1 or more."),
});

type Values = z.infer<typeof newBinSchema>;

/** Builds the POST body, or the per-field errors. Exported for tests. */
export function buildBinBody(v: Values):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; errors: Partial<Record<keyof Values, string>> } {
  const parsed = newBinSchema.safeParse(v);
  if (!parsed.success) {
    const errors: Partial<Record<keyof Values, string>> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0] as keyof Values;
      if (!errors[k]) errors[k] = issue.message;
    }
    return { ok: false, errors };
  }
  const d = parsed.data;
  const body: Record<string, unknown> = { storeId: d.storeId, code: d.code };
  if (d.aisle) body.aisle = d.aisle;
  if (d.rack) body.rack = d.rack;
  if (d.shelf) body.shelf = d.shelf;
  if (d.capacity) body.capacity = Number(d.capacity);
  return { ok: true, body };
}

export function NewBinForm({ stores }: { stores: StoreOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<Values>({ storeId: "", code: "", aisle: "", rack: "", shelf: "", capacity: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const formError = useFormError("bin");

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const built = buildBinBody(values);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/inventory/bins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.body),
      });
      if (!res.ok) {
        const r = await formError.fromResponse(res, "save");
        setMessage(r.message);
        setErrors((p) => ({ ...p, ...(r.fieldErrors as Partial<Record<keyof Values, string>>) }));
        return;
      }
      // 202: the bin is created asynchronously, so it may take a moment to appear.
      toast.success("Bin request received. It will appear in the register shortly.");
      router.push("/inventory/bins");
      router.refresh();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void submit(e)} noValidate style={{ maxWidth: 560 }} aria-label="New bin">
      <Field label="Store" required error={errors.storeId}>
        <Select value={values.storeId} onChange={set("storeId")}>
          <option value="">Choose a store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Bin code" required error={errors.code}>
        <Input value={values.code} onChange={set("code")} maxLength={64} />
      </Field>
      <Field label="Aisle" error={errors.aisle}>
        <Input value={values.aisle} onChange={set("aisle")} maxLength={16} />
      </Field>
      <Field label="Rack" error={errors.rack}>
        <Input value={values.rack} onChange={set("rack")} maxLength={16} />
      </Field>
      <Field label="Shelf" error={errors.shelf}>
        <Input value={values.shelf} onChange={set("shelf")} maxLength={16} />
      </Field>
      <Field label="Capacity (units)" error={errors.capacity}>
        <Input value={values.capacity} onChange={set("capacity")} inputMode="numeric" />
      </Field>
      <div role="status" aria-live="polite">
        {message ? <p role="alert" style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{message}</p> : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? "Saving…" : "Create bin"}
        </button>
        <Link href="/inventory/bins" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
