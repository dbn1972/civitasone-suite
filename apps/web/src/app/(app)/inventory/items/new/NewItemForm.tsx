"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Field, Input, Select, useToast } from "@/app/_components/ds";
import { parseRupeesToPaise } from "@/lib/money";
import { useFormError } from "@/lib/useFormError";

export type Option = { id: string; name: string };

const count = (label: string) =>
  z.string().trim().refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 1_000_000), `${label}: enter a whole number up to 1,000,000.`);

/** Mirrors inventory-service createItemBody. */
export const newItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Must be at most 200 characters."),
  sku: z.string().trim().max(64, "Must be at most 64 characters."),
  itemType: z.enum(["consumable", "fixed_asset", "service"]),
  categoryId: z.string(),
  uomId: z.string(),
  reorderLevel: count("Reorder level"),
  reorderQty: count("Reorder quantity"),
  unitCost: z.string().trim(),
});
type Values = z.infer<typeof newItemSchema>;

export function buildItemBody(v: Values):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; errors: Partial<Record<keyof Values, string>> } {
  const parsed = newItemSchema.safeParse(v);
  const errors: Partial<Record<keyof Values, string>> = {};
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const k = i.path[0] as keyof Values;
      if (!errors[k]) errors[k] = i.message;
    }
  }
  // Standard cost is typed in rupees and sent as integer paise (never float math).
  let paise = 0;
  if (v.unitCost.trim() !== "") {
    const p = parseRupeesToPaise(v.unitCost);
    if (p === null || !Number.isSafeInteger(Number(p))) errors.unitCost = "Enter an amount in rupees with at most 2 decimals.";
    else paise = Number(p);
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  const d = parsed.data;
  const body: Record<string, unknown> = { name: d.name, itemType: d.itemType, unitCostMinor: paise };
  if (d.sku) body.sku = d.sku;
  if (d.categoryId) body.categoryId = d.categoryId;
  if (d.uomId) body.uomId = d.uomId;
  if (d.reorderLevel) body.reorderLevel = Number(d.reorderLevel);
  if (d.reorderQty) body.reorderQty = Number(d.reorderQty);
  return { ok: true, body };
}

export function NewItemForm({ categories, uoms }: { categories: Option[]; uoms: Option[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<Values>({
    name: "", sku: "", itemType: "consumable", categoryId: "", uomId: "", reorderLevel: "", reorderQty: "", unitCost: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const formError = useFormError("item");

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const built = buildItemBody(values);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/inventory/items", {
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
      toast.success("Item request received. It will appear in the item master shortly.");
      router.push("/inventory/items");
      router.refresh();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void submit(e)} noValidate style={{ maxWidth: 560 }} aria-label="New item">
      <Field label="Item name" required error={errors.name}>
        <Input value={values.name} onChange={set("name")} maxLength={200} />
      </Field>
      <Field label="SKU" error={errors.sku}>
        <Input value={values.sku} onChange={set("sku")} maxLength={64} />
      </Field>
      <Field label="Type" required error={errors.itemType}>
        <Select value={values.itemType} onChange={set("itemType")}>
          <option value="consumable">Consumable</option>
          <option value="fixed_asset">Fixed asset</option>
          <option value="service">Service</option>
        </Select>
      </Field>
      <Field label="Category" error={errors.categoryId}>
        <Select value={values.categoryId} onChange={set("categoryId")}>
          <option value="">None</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Unit of measure" error={errors.uomId}>
        <Select value={values.uomId} onChange={set("uomId")}>
          <option value="">None</option>
          {uoms.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      </Field>
      <Field label="Reorder level" error={errors.reorderLevel}>
        <Input value={values.reorderLevel} onChange={set("reorderLevel")} inputMode="numeric" />
      </Field>
      <Field label="Reorder quantity" error={errors.reorderQty}>
        <Input value={values.reorderQty} onChange={set("reorderQty")} inputMode="numeric" />
      </Field>
      <Field label="Standard cost (₹)" error={errors.unitCost}>
        <Input value={values.unitCost} onChange={set("unitCost")} inputMode="decimal" />
      </Field>
      <div role="status" aria-live="polite">
        {message ? <p role="alert" style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{message}</p> : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? "Saving…" : "Create item"}
        </button>
        <Link href="/inventory/items" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
