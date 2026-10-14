"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, Card, Button, ConfirmDialog, RefreshErrorState, useToast, AcceptedNotice } from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { formatMoney } from "@/lib/formatters";
import { MasterCreateForm } from "./MasterCreateForm";
import { humanizeMaster, PARENT_FIELD, TYPE_COLUMNS, type MasterType, type MasterColumn } from "./masterTypes";
import { UserFacingError } from "@/lib/userFacingError";
import { useFormError } from "@/lib/useFormError";

export interface MasterItem {
  id: string;
  version?: number;
  [key: string]: unknown;
}

export interface ParentOption {
  id: string;
  label: string;
}

interface MastersTableProps {
  masterType: MasterType;
  items: MasterItem[];
  /** true when the list fetch failed — show a retry state, not an empty "add first entry" (GAP-WORKS-MASTERS-01). */
  failed: boolean;
  /** Whether the signed-in user may create/edit/deactivate (GAP-WORKS-MASTERS-02/04). */
  canManage: boolean;
  /** Options for the parent picker (GAP-WORKS-MASTERS-03), keyed id -> label. */
  parentOptions: ParentOption[];
  /** True tenant-wide count for this master type (GAP2-WORKS-MASTERS-09). */
  total?: number;
}

type DisplayRow = Record<string, string> & { __id: string; __version: string };

/** A 202-accepted write whose effect is not yet visible in the read model (GAP-WORKS-MASTERS-05). */
type PendingWrite =
  | { kind: "create"; name: string; code: string; baselineTotal: number }
  | { kind: "update"; id: string; version: number };

const PENDING_ID = "__pending";

export function MastersTable({ masterType, items, failed, canManage, parentOptions, total }: MastersTableProps) {
  const t = useTranslations("works.masters");
  const [pendingRow, setPendingRow] = useState<{ name: string; code: string; baselineTotal: number } | null>(null);
  // Confirm the 202 against the type's own GET endpoints (bounded, backed-off polling; no timer refresh). When the
  // change becomes visible the hook refreshes the page data and the pending row is dropped.
  const accepted = useAcceptedWrite<PendingWrite, { total?: number; version?: number }>({
    poll: async (w) => {
      const url =
        w.kind === "create"
          ? `/api/proxy/v1/works/masters/${masterType}?page=1&pageSize=1`
          : `/api/proxy/v1/works/masters/${masterType}/${w.id}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("not visible yet");
      const body = (await res.json()) as { data?: { version?: number }; meta?: { total?: number } };
      return w.kind === "create" ? { total: body.meta?.total } : { version: body.data?.version };
    },
    isDone: (p, w) => (w.kind === "create" ? (p.total ?? 0) > w.baselineTotal : (p.version ?? 0) > w.version),
    onConfirmed: () => setPendingRow(null),
  });
  const currentTotal = total ?? items.length;
  // The pending row is shown only until the read model reports a larger set (also true after a manual refresh).
  const showPendingRow = pendingRow !== null && currentTotal <= pendingRow.baselineTotal && accepted.phase !== "idle" && accepted.phase !== "confirmed";
  const createPending = showPendingRow && (accepted.phase === "pending" || accepted.phase === "accepted" || accepted.phase === "submitting");
  const { toast } = useToast();
  const formError = useFormError("master data");
  const typeLabel = humanizeMaster(masterType);
  const parent = PARENT_FIELD[masterType];
  const parentNameById = new Map(parentOptions.map((o) => [o.id, o.label]));

  const [editing, setEditing] = useState<MasterItem | null>(null);
  const [deactivating, setDeactivating] = useState<MasterItem | null>(null);
  const [busy, setBusy] = useState(false);

  // ── GAP-WORKS-MASTERS-01: an outage must NOT render the "add the first
  // entry" empty state beside an enabled create form — that invites duplicate
  // master records. Show a retry state and hide the create form instead. ──
  if (failed) {
    return (
      <Card title={typeLabel}>
        <RefreshErrorState
          error={{
            what: `We couldn't load the ${typeLabel.toLowerCase()} list.`,
            next: "This is usually temporary. Retry in a moment; if it persists, contact support.",
            actions: ["retry", "back", "help"],
          }}
          backHref="/works"
        />
      </Card>
    );
  }

  // ── Column config (GAP-WORKS-MASTERS-07): per-type columns for sr-items /
  // assets; generic Name/Code/Active otherwise, with a Parent column added
  // for types that reference one (GAP-WORKS-MASTERS-03). ──
  const typeCols: MasterColumn[] = TYPE_COLUMNS[masterType] ?? [
    { key: "name", label: "Name" },
    { key: "code", label: "Code" },
  ];

  const columns: { key: string; label: string; align?: "right" }[] = [];
  for (const c of typeCols) columns.push({ key: c.key, label: c.label, ...(c.money ? { align: "right" as const } : {}) });
  if (parent) columns.push({ key: "__parent", label: parent.label });
  columns.push({ key: "__active", label: "Active" });
  if (canManage) columns.push({ key: "__actions", label: "" });

  const moneyKeys = new Set(typeCols.filter((c) => c.money).map((c) => c.key));

  const rows: DisplayRow[] = items.map((item) => {
    const row: DisplayRow = { __id: String(item.id ?? ""), __version: String(item.version ?? 1) };
    for (const c of typeCols) {
      const raw = item[c.key];
      if (moneyKeys.has(c.key)) {
        row[c.key] = formatMoney(raw as string | number | null | undefined);
      } else {
        row[c.key] = raw != null && raw !== "" ? String(raw) : "—";
      }
    }
    if (parent) {
      const pid = item[parent.field];
      row.__parent = pid != null ? (parentNameById.get(String(pid)) ?? `${String(pid).slice(0, 8)}…`) : "—";
    }
    // GAP-WORKS-MASTERS-07: when the API omits `active`, say "Not set" rather
    // than "—" (which reads as unknown/absent and is easily confused with a
    // genuinely empty text field).
    row.__active = item.active == null ? "Not set" : item.active ? "Yes" : "No";
    return row;
  });
  // GAP-WORKS-MASTERS-05: show the entry we just submitted as a pending row until the read model has it.
  if (showPendingRow && pendingRow) {
    const row: DisplayRow = { __id: PENDING_ID, __version: "1" };
    for (const c of typeCols) row[c.key] = c.key === "name" ? pendingRow.name : c.key === "code" ? pendingRow.code || "—" : "—";
    if (parent) row.__parent = "—";
    row.__active = t("pending");
    rows.unshift(row);
  }

  async function doDeactivate(item: MasterItem) {
    setBusy(true);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/works/masters/${masterType}/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false, version: Number(item.version ?? 1) }),
      });
      if (res.status !== 202) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      toast.success("Deactivated. Changes will reflect shortly.");
      setDeactivating(null);
      void accepted.accept({ kind: "update", id: String(item.id), version: Number(item.version ?? 1) });
    } catch (err) {
      toast.error(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AcceptedNotice {...accepted.noticeProps} onDismiss={() => { setPendingRow(null); accepted.reset(); }} />
      {canManage && !editing && (
        <MasterCreateForm
          masterType={masterType}
          parentOptions={parentOptions}
          createLocked={createPending}
          onCreated={(body) => {
            setPendingRow({ name: String(body?.name ?? body?.itemCode ?? body?.keyword ?? ""), code: String(body?.code ?? ""), baselineTotal: currentTotal });
            void accepted.accept({ kind: "create", name: String(body?.name ?? ""), code: String(body?.code ?? ""), baselineTotal: currentTotal });
          }}
        />
      )}
      {canManage && editing && (
        <MasterCreateForm
          masterType={masterType}
          parentOptions={parentOptions}
          editItem={editing}
          onDone={() => setEditing(null)}
          // The edit form unmounts on save, so the table owns the accepted notice (and its refresh).
          onCreated={() => void accepted.accept({ kind: "update", id: String(editing.id), version: Number(editing.version ?? 1) })}
        />
      )}

      <div style={{ marginTop: 16 }}>
        <Card title={`${typeLabel} (${rows.length})`}>
          {typeof total === "number" && rows.length < total ? (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }} role="note">
              Showing the first {rows.length} of {total} {typeLabel.toLowerCase()}.
            </p>
          ) : null}
          <DataTable<DisplayRow>
            columns={columns.map((c) =>
              c.key === "__actions"
                ? {
                    ...c,
                    render: (r: DisplayRow) => r.__id === PENDING_ID ? (
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("pendingNote")}</span>
                    ) : (
                      <span style={{ display: "inline-flex", gap: 8 }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(items.find((it) => String(it.id) === r.__id) ?? null)}
                        >
                          Edit
                        </Button>
                        {r.__active !== "No" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeactivating(items.find((it) => String(it.id) === r.__id) ?? null)}
                          >
                            Deactivate
                          </Button>
                        )}
                      </span>
                    ),
                  }
                : c.key === "__active" || c.key === "__parent" || moneyKeys.has(c.key)
                  ? c
                  : c,
            )}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={`Filter ${typeLabel.toLowerCase()}…`}
            pageSize={25}
            rowKey={(r) => r.__id}
            emptyIcon="📂"
            emptyTitle={`No ${typeLabel.toLowerCase()} yet`}
            emptyMessage={canManage ? "Use the form above to add the first entry." : "No entries have been added yet."}
            caption={`${typeLabel} master registry list`}
          />
        </Card>
      </div>

      {deactivating && (
        <ConfirmDialog
          open
          title={`Deactivate this ${typeLabel.replace(/s$/, "").toLowerCase()}?`}
          description="It will be hidden from new selections. Existing records that already reference it are unaffected. You can re-create or re-activate it later — masters are never permanently deleted."
          confirmLabel={busy ? "Deactivating…" : "Deactivate"}
          onConfirm={() => void doDeactivate(deactivating)}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </>
  );
}
