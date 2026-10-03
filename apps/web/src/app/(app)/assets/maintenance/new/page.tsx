"use client";

/**
 * Log / schedule a maintenance job (work order).
 * POSTs to the real asset-service endpoint POST /v1/assets/work-orders
 * (body: { assetId: uuid, scheduledDate: "YYYY-MM-DD", maintenanceType, notes? }) via the
 * gateway proxy (/api/proxy/v1/asset/...). Assets are found with the register's
 * server-side search (GET /v1/asset/assets?search=).
 */
import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, ConfirmDialog, EntityPicker, ErrorState, Field, PageHeader } from "../../../../_components/ds";
import type { EntityOption } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { searchAssets, resolveAssets } from "@/lib/entityAdapters/assetPicker";
import {
  MAINTENANCE_TYPES,
  MAINTENANCE_TYPE_LABELS,
  pageTitleFor,
  parseAssetIdParam,
  parseMaintenanceType,
  validateScheduledDate,
  type MaintenanceType,
} from "./workOrderForm";
import { todayIST } from "@/lib/formatters";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewWorkOrderPage() {
  // useSearchParams() needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <NewWorkOrderForm />
    </Suspense>
  );
}

function NewWorkOrderForm() {
  const params = useSearchParams();
  const [type, setType] = useState<MaintenanceType>(parseMaintenanceType(params.get("type")));
  const [assetId, setAssetId] = useState<string | null>(parseAssetIdParam(params.get("assetId")));
  const [scheduledDate, setScheduledDate] = useState(todayIST());
  const [dateError, setDateError] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // null = no asset-search failure; number = HTTP status; -1 = network error
  const [loadFailure, setLoadFailure] = useState<number | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const labels = useRef(new Map<string, string>());
  const dateRef = useRef<HTMLInputElement>(null);
  const formError = useFormError("work order");
  const heading = pageTitleFor(type);

  const remember = useCallback((opts: EntityOption[]) => {
    for (const o of opts) labels.current.set(o.id, o.label);
    return opts;
  }, []);
  const search = useCallback(
    async (q: string, signal: AbortSignal) =>
      remember(await searchAssets(q, signal, { onError: (s) => setLoadFailure(s ?? -1), onOk: () => setLoadFailure(null) })),
    [remember],
  );
  const resolve = useCallback(async (ids: string[]) => remember(await resolveAssets(ids)), [remember]);
  const initialOptions = useMemo(() => [] as EntityOption[], []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId) return;
    const err = validateScheduledDate(type, scheduledDate);
    setDateError(err ?? "");
    if (err) {
      dateRef.current?.focus();
      return;
    }
    setMessage("");
    setConfirmOpen(true);
  }

  async function submit() {
    if (!assetId) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/proxy/v1/asset/work-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId, scheduledDate, maintenanceType: type, notes: notes || undefined }),
      });
      setConfirmOpen(false);
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-ASSETS-MAINTENANCE-NEW-04: the confirmation stays on screen (no timed
      // redirect that could cut a screen-reader announcement off); the user
      // follows the link when ready.
      setDone(true);
      setMessage("Maintenance job submitted. It appears in the jobs list once processed.");
      setNotes("");
    } catch (caught) {
      setConfirmOpen(false);
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const failed = loadFailure !== null;
  const assetLabel = assetId ? labels.current.get(assetId) ?? "the selected asset" : "";

  return (
    <>
      <PageHeader title={heading.title} subtitle={heading.subtitle} back="/assets/maintenance" backLabel="Asset Maintenance" />
      {message ? (
        <div
          role={isError ? "alert" : "status"}
          aria-live={isError ? "assertive" : "polite"}
          className={`pill ${isError ? "bad" : "good"}`}
          style={{ display: "block", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13, whiteSpace: "normal" }}
        >
          <strong>{isError ? "Error: " : "Done: "}</strong>
          {message}
          {done && !isError ? (
            <>
              {" "}
              <Link href="/assets/maintenance">View maintenance jobs</Link>
            </>
          ) : null}
        </div>
      ) : null}
      {loadFailure === 403 ? (
        <PermissionDenied module="assets" backHref="/assets/maintenance" backLabel="Asset Maintenance" />
      ) : failed ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="pad">
            <ErrorState
              error={toHumanError("load", { area: "assets" })}
              onRetry={() => {
                setLoadFailure(null);
                setPickerKey((k) => k + 1);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="card">
          <form onSubmit={handleSubmit} className="pad">
            <div className="fields">
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="wo-type">Type</label>
                <select id="wo-type" value={type} onChange={(e) => { setType(parseMaintenanceType(e.target.value)); setDateError(""); }} style={inputStyle}>
                  {MAINTENANCE_TYPES.map((t) => (
                    <option key={t} value={t}>{MAINTENANCE_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", width: "100%" }}>
                <Field label="Asset" required>
                  <EntityPicker
                    key={pickerKey}
                    value={assetId}
                    onChange={(v) => setAssetId(Array.isArray(v) ? v[0] ?? null : v)}
                    search={search}
                    resolve={resolve}
                    initialOptions={initialOptions}
                    placeholder="Search by asset code or name…"
                    noResultsText="No matching assets"
                    searchingText="Searching…"
                    minQueryLength={1}
                  />
                </Field>
              </div>
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="wo-date">Scheduled date</label>
                <input
                  id="wo-date"
                  ref={dateRef}
                  required
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => { setScheduledDate(e.target.value); setDateError(""); }}
                  aria-invalid={dateError ? true : undefined}
                  aria-describedby={dateError ? "wo-date-err" : undefined}
                  style={inputStyle}
                />
                {dateError ? <p id="wo-date-err" role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: "4px 0 0" }}>{dateError}</p> : null}
              </div>
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="wo-notes">Notes</label>
                <input id="wo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <Button type="submit" disabled={busy || !assetId} aria-busy={busy} style={{ marginTop: 12 }}>
              {busy ? "Saving…" : heading.submit}
            </Button>
          </form>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={`${heading.submit}?`}
        confirmLabel="Confirm"
        busy={busy}
        description={
          <>
            Raise a <strong>{MAINTENANCE_TYPE_LABELS[type].toLowerCase()}</strong> work order for <strong>{assetLabel}</strong> scheduled on{" "}
            <strong>{scheduledDate}</strong>.
          </>
        }
        onConfirm={() => void submit()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </>
  );
}
