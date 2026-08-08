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
  /** Optional controlled search (tests / parent). */
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
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

export function MergeFieldPicker({
  fields = DEFAULT_FIELDS,
  onInsert,
  disabled,
  searchQuery,
  onSearchQueryChange,
}: MergeFieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [internalQuery, setInternalQuery] = useState("");
  const query = searchQuery ?? internalQuery;
  const setQuery = onSearchQueryChange ?? setInternalQuery;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        f.label.toLowerCase().includes(q) ||
        f.group.toLowerCase().includes(q),
    );
  }, [fields, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, MergeField[]>();
    for (const f of filtered) {
      const list = map.get(f.group) ?? [];
      list.push(f);
      map.set(f.group, list);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn ghost"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        Insert field
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Merge fields"
          data-testid="merge-field-picker"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "100%",
            left: 0,
            marginTop: 4,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: 320,
            overflow: "auto",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
            boxShadow: "var(--shadow-md)",
            padding: 8,
          }}
        >
          <label style={{ display: "block", marginBottom: 8 }}>
            <span className="sr-only">Search fields</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fields…"
              aria-label="Search merge fields"
              data-testid="merge-field-search"
              style={{ width: "100%", fontSize: 13 }}
              autoFocus
            />
          </label>
          {grouped.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>No fields match “{query}”.</p>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "var(--mut)", marginBottom: 4 }}>{group}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {items.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className="btn ghost"
                      title={`{{${f.key}}}`}
                      style={{ fontSize: 12, padding: "2px 8px" }}
                      onClick={() => {
                        onInsert(`{{${f.key}}}`);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--mut)" }}>
            Form answers appear when B2 fields are saved on this service.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Render merge tokens as pills in read-only preview. */
export function renderMergePills(text: string): string {
  return text.replace(/\{\{([^}]+)\}\}/g, "⟨$1⟩");
}
