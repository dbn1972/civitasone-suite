"use client";

import { useMemo, useState } from "react";

export interface MergeField {
  key: string;
  label: string;
  group: string;
}

export interface MergeFieldPickerProps {
  fields?: MergeField[];
  onInsert: (token: string) => void;
  disabled?: boolean;
}

const DEFAULT_FIELDS: MergeField[] = [
  { key: "applicant_name", label: "Applicant name", group: "Application" },
  { key: "app_no", label: "Application number", group: "Application" },
  { key: "service_name", label: "Service name", group: "Service" },
  { key: "cert_no", label: "Certificate number", group: "Issuance" },
  { key: "valid_to", label: "Valid until", group: "Issuance" },
  { key: "amount", label: "Fee amount", group: "Payment" },
  { key: "pay_link", label: "Payment link", group: "Payment" },
  { key: "office_name", label: "Office name", group: "Tenant" },
  { key: "ward", label: "Ward", group: "Location" },
];

export function MergeFieldPicker({ fields = DEFAULT_FIELDS, onInsert, disabled }: MergeFieldPickerProps) {
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, MergeField[]>();
    for (const f of fields) {
      const list = map.get(f.group) ?? [];
      list.push(f);
      map.set(f.group, list);
    }
    return [...map.entries()];
  }, [fields]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn ghost"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Insert field
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Merge fields"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "100%",
            left: 0,
            marginTop: 4,
            minWidth: 240,
            maxHeight: 280,
            overflow: "auto",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
            boxShadow: "var(--shadow-md)",
            padding: 8,
          }}
        >
          {grouped.map(([group, items]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--mut)", marginBottom: 4 }}>{group}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {items.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12, padding: "2px 8px" }}
                    onClick={() => {
                      onInsert(`{{${f.key}}}`);
                      setOpen(false);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Render merge tokens as pills in read-only preview. */
export function renderMergePills(text: string): string {
  return text.replace(/\{\{([^}]+)\}\}/g, "⟨$1⟩");
}
