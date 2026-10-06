"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useFormError } from "@/lib/useFormError";
import { parseRupeesToPaise } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { Field, Input, EntityPicker, type EntityOption } from "@/app/_components/ds";

export type VendorChoice = { id: string; name: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GAP-CONTRACTS-NEW-02: a single zod schema validated once (safeParse), so
// EVERY invalid field is reported together with its own inline message, not
// one-at-a-time top-banner messages. GAP-CONTRACTS-NEW-03: value is parsed to
// paise with exact string math (parseRupeesToPaise) — no float multiply.
const schema = z
  .object({
    contractNo: z.string().trim().min(1, "Contract number is required."),
    title: z.string().trim().min(1, "Title is required."),
    vendorId: z.string().regex(UUID_RE, "Select a vendor."),
    value: z
      .string()
      .trim()
      .min(1, "Value is required.")
      .refine((v) => parseRupeesToPaise(v) !== null, "Enter a positive amount with at most two decimals."),
    startDate: z.string().min(1, "Start date is required."),
    expiry: z.string().min(1, "Expiry date is required."),
  })
  .refine((d) => !d.startDate || !d.expiry || d.expiry >= d.startDate, {
    path: ["expiry"],
    message: "Expiry date must be on or after start date.",
  });

type FieldName = "contractNo" | "title" | "vendorId" | "value" | "startDate" | "expiry";

export function NewContractForm({ vendors = [] }: { vendors?: VendorChoice[] }) {
  const router = useRouter();

  const [contractNo, setContractNo] = useState("");
  const [title, setTitle] = useState("");
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [expiry, setExpiry] = useState("");
  const [value, setValue] = useState("");

  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const formError = useFormError("contract");

  const formRef = useRef<HTMLFormElement>(null);

  // Vendor options as {id,label}. The whole list is loaded server-side (small,
  // department-scoped) and searched in-memory — no extra endpoint needed.
  const options: EntityOption[] = useMemo(
    () => vendors.map((v) => ({ id: v.id, label: v.name, sublabel: v.id })),
    [vendors],
  );
  const search = useCallback(
    async (query: string): Promise<EntityOption[]> => {
      const q = query.toLowerCase();
      return options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q));
    },
    [options],
  );
  const resolve = useCallback(
    async (ids: string[]): Promise<EntityOption[]> => options.filter((o) => ids.includes(o.id)),
    [options],
  );

  // Live money preview (GAP-CONTRACTS-NEW-03).
  const valuePreview = useMemo(() => {
    const paise = parseRupeesToPaise(value);
    return paise ? formatMoney(paise) : null;
  }, [value]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const parsed = schema.safeParse({
      contractNo,
      title,
      vendorId: vendorId ?? "",
      value,
      startDate,
      expiry,
    });

    if (!parsed.success) {
      const errs: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const name = issue.path[0] as FieldName | undefined;
        if (name && !errs[name]) errs[name] = issue.message;
      }
      setFieldErrors(errs);
      setStatus("error");
      setMessage("");
      // Focus the first invalid field.
      const first = (["contractNo", "title", "vendorId", "value", "startDate", "expiry"] as FieldName[]).find(
        (n) => errs[n],
      );
      if (first) formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"] input`)?.focus();
      return;
    }

    // GAP-CONTRACTS-NEW-03: paise is an exact integer string from string math.
    // contract-service's createContractBody expects `valueMinor` as
    // z.number().int().positive() (NOT a string — verified against
    // services/contract-service/.../contracts/validators.ts), so send the
    // Number of the exact digit string. There is no float multiply anywhere:
    // Number("123450") is exact for any value within a contract's realistic
    // range (well under Number.MAX_SAFE_INTEGER paise).
    const paise = parseRupeesToPaise(parsed.data.value)!;

    setStatus("submitting");
    setFieldErrors({});
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/contract/contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractNo: parsed.data.contractNo.trim(),
          vendorId: parsed.data.vendorId,
          title: parsed.data.title.trim(),
          valueMinor: Number(paise),
          startDate: parsed.data.startDate,
          expiry: parsed.data.expiry,
        }),
      });

      if (!res.ok) {
        const envelope = await formError.fromResponse(res, "save");
        // Map any backend field errors to the inline slots too.
        if (envelope.fieldErrors && Object.keys(envelope.fieldErrors).length > 0) {
          setFieldErrors(envelope.fieldErrors as Partial<Record<FieldName, string>>);
        }
        setStatus("error");
        setMessage(envelope.message);
        return;
      }

      setStatus("success");
      setMessage("Contract created successfully.");
      router.push("/contracts/list");
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 24,
        maxWidth: 672,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r)",
        boxShadow: "var(--sh-md)",
      }}
      noValidate
    >
      <div data-field="contractNo">
        <Field label="Contract No" required error={fieldErrors.contractNo}>
          <Input
            type="text"
            value={contractNo}
            onChange={(e) => setContractNo(e.target.value)}
            placeholder="e.g. CON-2024-0007"
            autoComplete="off"
          />
        </Field>
      </div>

      <div data-field="title">
        <Field label="Title" required error={fieldErrors.title}>
          <Input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Annual IT Maintenance"
            autoComplete="off"
          />
        </Field>
      </div>

      <div data-field="vendorId">
        <Field label="Vendor" required error={fieldErrors.vendorId}>
          {/* GAP-CONTRACTS-NEW-01: a searchable vendor picker (name + code),
              not a raw 36-char UUID text input. It returns the vendor's id. */}
          <EntityPicker
            value={vendorId}
            onChange={(v) => setVendorId(Array.isArray(v) ? (v[0] ?? null) : v)}
            search={search}
            resolve={resolve}
            initialOptions={options}
            placeholder="Search vendors by name or code…"
            aria-label="Vendor"
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div data-field="startDate">
          <Field label="Start Date" required error={fieldErrors.startDate}>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>
        <div data-field="expiry">
          <Field label="Expiry Date" required error={fieldErrors.expiry}>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        </div>
      </div>

      <div data-field="value">
        <Field label="Value (₹)" required error={fieldErrors.value}>
          <Input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 5,00,000"
            autoComplete="off"
          />
        </Field>
        {valuePreview ? (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink2)" }}>{valuePreview}</p>
        ) : null}
      </div>

      <button type="submit" disabled={status === "submitting"} className="btn primary" style={{ minHeight: 44, minWidth: 44 }}>
        {status === "submitting" ? "Creating…" : "Create Contract"}
      </button>

      {message && (
        <p
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          style={{ fontSize: 13, margin: 0, color: status === "error" ? "var(--bad)" : "var(--good)" }}
        >
          <span style={{ fontWeight: 600 }}>{status === "error" ? "Error: " : "Success: "}</span>
          {message}
        </p>
      )}
    </form>
  );
}
