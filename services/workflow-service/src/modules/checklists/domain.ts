/**
 * CAP-036 — checklist / prerequisite-gating engine (pure domain).
 *
 * A checklist is an ordered set of items, each optionally `required`. A gate is
 * OPEN only when every required item is checked. This module holds the item
 * model, the gating decision, and the toggle logic; persistence is the caller's.
 */

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  checked: boolean;
  checkedBy?: string | null;
  checkedAt?: string | null;
}

export interface GateResult {
  open: boolean;
  totalRequired: number;
  requiredCompleted: number;
  blockingKeys: string[];
}

/** Normalize a template item definition into a fresh unchecked instance item. */
export function instantiate(templateItems: Array<{ key: string; label: string; required?: boolean }>): ChecklistItem[] {
  return templateItems.map((t) => ({
    key: t.key, label: t.label, required: t.required ?? false, checked: false, checkedBy: null, checkedAt: null,
  }));
}

/** The gate opens once every required item is checked. */
export function evaluateGate(items: ChecklistItem[]): GateResult {
  const required = items.filter((i) => i.required);
  const blocking = required.filter((i) => !i.checked);
  return {
    open: blocking.length === 0,
    totalRequired: required.length,
    requiredCompleted: required.length - blocking.length,
    blockingKeys: blocking.map((i) => i.key),
  };
}

export interface ToggleResult {
  items: ChecklistItem[];
  found: boolean;
}

/** Set an item's checked state (idempotent); records who/when when checking. */
export function toggleItem(items: ChecklistItem[], key: string, checked: boolean, actorId: string, at: string): ToggleResult {
  let found = false;
  const next = items.map((i) => {
    if (i.key !== key) return i;
    found = true;
    return checked
      ? { ...i, checked: true, checkedBy: actorId, checkedAt: at }
      : { ...i, checked: false, checkedBy: null, checkedAt: null };
  });
  return { items: next, found };
}

/** Validate a template's item definitions: non-empty, unique keys. */
export function validateTemplate(items: Array<{ key?: unknown; label?: unknown }>): { allowed: boolean; errors: string[] } {
  const errors: string[] = [];
  if (items.length === 0) errors.push("NO_ITEMS");
  const keys = new Set<string>();
  for (const it of items) {
    if (typeof it.key !== "string" || it.key.length === 0) { errors.push("INVALID_KEY"); continue; }
    if (typeof it.label !== "string" || it.label.length === 0) errors.push("INVALID_LABEL");
    if (keys.has(it.key)) errors.push("DUPLICATE_KEY");
    keys.add(it.key);
  }
  return { allowed: errors.length === 0, errors };
}
