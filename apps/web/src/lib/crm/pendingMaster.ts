/**
 * Optimistic reconcile for the queue-backed code masters (service types, grievance
 * categories). Their writes answer 202 before the consumer commits, so a reload right
 * after a save can still return the OLD rows (a saved row vanishes, an edit reverts, a
 * deleted row reappears). We keep each submitted change as a pending op and overlay it on
 * every read until the server reflects it.
 */
export interface MasterRow {
  id?: string;
  code: string;
  label: string;
  active: boolean;
  sortOrder: number;
}

export type PendingOp<R extends MasterRow> = { kind: "upsert"; row: R } | { kind: "delete"; id: string };

function sameFields(a: MasterRow, b: MasterRow): boolean {
  return a.label.trim() === b.label.trim() && a.active === b.active && a.sortOrder === b.sortOrder;
}

/** Overlay `pending` on a server read; `remaining` are the ops the server has not reflected yet. */
export function reconcile<R extends MasterRow>(
  server: R[],
  pending: PendingOp<R>[],
): { rows: R[]; remaining: PendingOp<R>[] } {
  let rows = [...server];
  const remaining: PendingOp<R>[] = [];
  for (const op of pending) {
    if (op.kind === "delete") {
      if (rows.some((r) => r.id === op.id)) {
        rows = rows.filter((r) => r.id !== op.id);
        remaining.push(op);
      }
      continue;
    }
    const idx = rows.findIndex((r) => (op.row.id ? r.id === op.row.id : r.code === op.row.code));
    if (idx >= 0) {
      if (!sameFields(rows[idx]!, op.row)) {
        rows[idx] = { ...rows[idx]!, label: op.row.label.trim(), active: op.row.active, sortOrder: op.row.sortOrder };
        remaining.push(op);
      }
    } else {
      rows.push({ ...op.row, label: op.row.label.trim() });
      remaining.push(op);
    }
  }
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return { rows, remaining };
}
