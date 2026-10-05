"use client";
/**
 * GrievanceCategoriesEditor — GAP-CRM-GRIEVANCES-NEW-03 admin. CRUD the
 * per-tenant master of grievance categories (code, label, active, sort order),
 * mirroring DocumentTypesEditor / ServiceTypesEditor. A row is blocked from
 * saving until it has a valid lowercase snake_case code and a label. A failed
 * load shows the saved-info badge and never fabricates an empty catalogue.
 * Delete goes through ConfirmDialog.
 *
 * The default CPGRAMS-aligned category list lives in
 * @/lib/crm/grievanceCategories as the labelled fallback for the citizen form;
 * this editor seeds nothing — a tenant with no configured categories correctly
 * shows the empty state and uses that fallback.
 */
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { reconcile, type PendingOp } from "@/lib/crm/pendingMaster";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import {
  getGrievanceCategories,
  createGrievanceCategory,
  updateGrievanceCategory,
  deleteGrievanceCategory,
  validateGrievanceCategory,
  isGrievanceCategoryValid,
  DEFAULT_GRIEVANCE_CATEGORIES,
  type GrievanceCategory,
  type MasterSource,
} from "@/lib/crm/grievanceCategories";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

interface Row extends GrievanceCategory {
  key: string;
}
const DEFAULT_RETRY_DELAYS_MS = [300, 700, 1200, 2000, 3000] as const;
let SEQ = 0;
function toRow(c: GrievanceCategory): Row {
  return { ...c, key: c.id ?? `new-${SEQ++}` };
}
function blank(): GrievanceCategory {
  return { code: "", label: "", active: true, sortOrder: 0 };
}

export function GrievanceCategoriesEditor({ retryDelaysMs = DEFAULT_RETRY_DELAYS_MS }: { retryDelaysMs?: readonly number[] } = {}) {
  const t = useTranslations("crmGrievanceCategoriesEditor");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<MasterSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const headingId = useId();
  const formError = useFormError("grievance category");
  // Changes submitted (202) but not yet visible in the server read; overlaid on every load.
  const pending = useRef<PendingOp<Row>[]>([]);
  const mounted = useRef(true);
  const [applying, setApplying] = useState(false);

  async function load(isLive: () => boolean = () => true, quiet = false) {
    if (!quiet) setSource("loading");
    const { data, source: s } = await getGrievanceCategories();
    if (!isLive()) return;
    const merged = reconcile(data.map(toRow), pending.current);
    pending.current = merged.remaining;
    setRows(merged.rows);
    setSource(s);
    setApplying(pending.current.length > 0);
  }

  /** Re-read with a short backoff until the consumer has committed the submitted change. */
  async function settle(): Promise<"confirmed" | "unconfirmed" | "unmounted"> {
    for (const d of [0, ...retryDelaysMs]) {
      if (d > 0) await new Promise((r) => setTimeout(r, d));
      if (!mounted.current) return "unmounted";
      await load(() => mounted.current, true);
      if (!mounted.current) return "unmounted";
      if (pending.current.length === 0) return "confirmed";
    }
    // Gave up: expire the pending ops so a phantom row is dropped and the screen shows server truth.
    pending.current = [];
    await load(() => mounted.current, true);
    return "unconfirmed";
  }
  useEffect(() => {
    let live = true;
    mounted.current = true;
    void load(() => live);
    return () => {
      live = false;
      mounted.current = false;
    };
  }, []);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, toRow(blank())]);
  }

  async function save(row: Row) {
    setMessage("");
    setError("");
    setAttempted((a) => ({ ...a, [row.key]: true }));
    const errors = validateGrievanceCategory(row);
    if (Object.keys(errors).length > 0) {
      setError(t("validationError", { name: row.label || row.code || t("newLabel"), error: errors.code ?? errors.label ?? "" }));
      return;
    }
    setBusyKey(row.key);
    try {
      if (row.id) await updateGrievanceCategory(row.id, row);
      else await createGrievanceCategory(row);
      // 202: the consumer has not necessarily committed yet. Show the change now and keep it
      // on screen across reloads until the server read reflects it.
      pending.current = [...pending.current, { kind: "upsert", row }];
      setMessage(t("submitted", { name: row.label.trim() }));
      setApplying(true);
      await load(() => true, true);
      const outcome = pending.current.length === 0 ? "confirmed" : await settle();
      if (outcome === "confirmed") setMessage(t("saved", { name: row.label.trim() }));
      else if (outcome === "unconfirmed") setMessage(t("unconfirmed", { name: row.label.trim() }));
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function doDelete(row: Row) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    setBusyKey(row.key);
    setError("");
    try {
      await deleteGrievanceCategory(row.id);
      pending.current = [...pending.current, { kind: "delete", id: row.id }];
      setMessage(t("submittedDelete", { name: row.label }));
      setApplying(true);
      setConfirmKey(null);
      await load(() => true, true);
      const outcome = pending.current.length === 0 ? "confirmed" : await settle();
      if (outcome === "confirmed") setMessage(t("deleted", { name: row.label }));
      else if (outcome === "unconfirmed") setMessage(t("unconfirmed", { name: row.label }));
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusyKey(null);
    }
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>{t("heading")}</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          {t("intro", { count: DEFAULT_GRIEVANCE_CATEGORIES.length })}
        </p>
        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: applying ? "var(--muted)" : "#047857", margin: 0 }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}

        {source === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{t("loading")}</p>
        ) : source === "error" ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            {t("unavailable")} <DataSourceBadge source="error" />
          </p>
        ) : rows.length === 0 ? (
          <EmptyState icon="🗣️" title={t("emptyTitle")} message={t("emptyMessage")} />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }} aria-label={t("heading")}>
            {rows.map((row) => {
              const errors = attempted[row.key] ? validateGrievanceCategory(row) : {};
              return (
                <li key={row.key} className="card" style={{ padding: 12, boxShadow: "none", border: "1px solid var(--line)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{t("code")}</span>
                      <input
                        value={row.code}
                        disabled={Boolean(row.id)}
                        onChange={(e) => update(row.key, { code: e.target.value.toLowerCase() })}
                        style={inputStyle}
                        aria-label={t("categoryCodeAria")}
                        aria-invalid={errors.code ? true : undefined}
                        placeholder={t("codePlaceholder")}
                      />
                      {errors.code ? <span style={{ fontSize: 11, color: "#b42318" }}>{errors.code}</span> : null}
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{t("label")}</span>
                      <input
                        value={row.label}
                        onChange={(e) => update(row.key, { label: e.target.value })}
                        style={inputStyle}
                        aria-label={t("categoryLabelAria")}
                        aria-invalid={errors.label ? true : undefined}
                        placeholder={t("labelPlaceholder")}
                      />
                      {errors.label ? <span style={{ fontSize: 11, color: "#b42318" }}>{errors.label}</span> : null}
                    </label>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                      <input type="checkbox" checked={row.active} onChange={(e) => update(row.key, { active: e.target.checked })} />
                      {t("active")}
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                      {t("sortOrder")}
                      <input
                        type="number"
                        min={0}
                        max={9999}
                        value={row.sortOrder}
                        onChange={(e) => update(row.key, { sortOrder: Number(e.target.value) || 0 })}
                        style={{ ...inputStyle, width: 80, minHeight: 32 }}
                        aria-label={t("sortOrder")}
                      />
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Button type="button" style={{ minHeight: 40 }} disabled={busyKey === row.key || !isGrievanceCategoryValid(row)} onClick={() => save(row)}>
                      {busyKey === row.key ? t("saving") : t("save")}
                    </Button>
                    <Button type="button" variant="danger" style={{ minHeight: 40 }} disabled={busyKey === row.key} onClick={() => setConfirmKey(row.key)}>
                      {t("delete")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {source !== "error" && source !== "loading" ? (
          <div>
            <Button type="button" variant="ghost" style={{ minHeight: 40 }} onClick={addRow}>
              {t("addCategory")}
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmKey !== null}
        title={t("deleteTitle")}
        description={
          confirmRow
            ? t("deleteDescription", { name: confirmRow.label || confirmRow.code })
            : ""
        }
        confirmLabel={t("delete")}
        danger
        busy={busyKey === confirmKey}
        onConfirm={() => confirmRow && doDelete(confirmRow)}
        onCancel={() => setConfirmKey(null)}
      />
    </div>
  );
}
