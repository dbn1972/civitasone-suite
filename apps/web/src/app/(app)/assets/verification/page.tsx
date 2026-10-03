"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, PageHeader, DataTable, EmptyState, ErrorState, ConfirmDialog, SkeletonTable, useConfirmAction } from "../../../_components/ds";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { SESSION_LIMIT, isAtSessionLimit } from "./sessions";
import { LocationPicker, type FunctionalLocation, type LocationsLoad } from "./LocationPicker";

type Verification = { id: string; status: string; verificationDate?: string; location?: string | null };

export default function AssetVerificationPage() {
  const [rows, setRows] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  // GAP-ASSETS-VERIFICATION-01: the session's site is chosen from the
  // functional-location master, never hard-coded.
  const [locations, setLocations] = useState<FunctionalLocation[]>([]);
  const [locationsLoad, setLocationsLoad] = useState<LocationsLoad>("loading");
  const [location, setLocation] = useState("");
  const [locationError, setLocationError] = useState("");
  const locationRef = useRef<HTMLSelectElement>(null);
  // GAP-ASSETS-VERIFICATION-04: the session date is chosen, defaulting to
  // today in India (never the UTC day, which is "yesterday" until 05:30 IST).
  const [verificationDate, setVerificationDate] = useState(() => todayIST());
  const [dateError, setDateError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/proxy/v1/asset/verifications?limit=${SESSION_LIMIT}`, { signal });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const body = await res.json() as { data?: Verification[] };
      setRows(body.data ?? []);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load]);

  const loadLocations = useCallback(async (signal?: AbortSignal) => {
    setLocationsLoad("loading");
    try {
      const res = await fetch("/api/proxy/v1/asset/locations", { signal });
      if (!res.ok) { setLocationsLoad("error"); return; }
      const body = await res.json() as { data?: FunctionalLocation[] };
      setLocations((body.data ?? []).filter((l) => l && typeof l.name === "string"));
      setLocationsLoad("ready");
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setLocationsLoad("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLocations(controller.signal);
    return () => controller.abort();
  }, [loadLocations]);

  function startNew() {
    if (!location) {
      setLocationError("Choose the location being verified.");
      locationRef.current?.focus();
      return;
    }
    setLocationError("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(verificationDate)) {
      setDateError("Choose the verification date.");
      return;
    }
    if (verificationDate > todayIST()) {
      setDateError("Verification date cannot be in the future.");
      return;
    }
    setDateError("");
    create.trigger();
  }

  const create = useConfirmAction({
    onConfirm: async (reason) => {
      const res = await fetch("/api/proxy/v1/asset/verifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          verificationDate,
          location,
          notes: (reason ?? "").trim(),
        }),
      });
      if (!res.ok) {
        const human = toHumanError("save", { area: "verification session" });
        throw new Error(`${human.what} ${human.next}`);
      }
      setMessage("Verification session created.");
      await load();
    },
  });

  const tableRows = rows.map((r) => ({
    id: r.id,
    session: r.id.slice(0, 8),
    date: formatIndianDate(r.verificationDate),
    location: r.location ?? "—",
    status: r.status,
  }));

  return (
    <>
      <PageHeader
        title="Physical Verification"
        subtitle="Physical-verification sessions — open a session to see the assets counted. Write-off and disposal are handled under Condemnation."
        back="/assets/dashboard"
        backLabel="Dashboard"
        actions={
          <>
            <Link href="/assets/condemnation" className="btn ghost">Condemnation &amp; write-off</Link>
            <Button type="button" onClick={startNew}>+ New verification</Button>
          </>
        }
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="pad">
          <LocationPicker
            locations={locations}
            load={locationsLoad}
            onRetry={() => void loadLocations()}
            value={location}
            onChange={(name) => { setLocation(name); setLocationError(""); }}
            error={locationError}
            selectRef={locationRef}
          />
          <div style={{ marginTop: 12 }}>
            <label className="l" htmlFor="verification-date">Verification date</label>
            <input
              id="verification-date"
              type="date"
              max={todayIST()}
              value={verificationDate}
              aria-required="true"
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? "verification-date-err" : undefined}
              onChange={(e) => { setVerificationDate(e.target.value); setDateError(""); }}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
            />
            {dateError ? <p id="verification-date-err" role="alert" style={{ color: "var(--bad)", fontSize: 12, margin: "4px 0 0" }}>{dateError}</p> : null}
          </div>
        </div>
      </div>
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "var(--panel)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        {loading ? (
          <SkeletonTable rows={5} />
        ) : loadError ? (
          <ErrorState error={toHumanError("load", { area: "verification sessions" })} onRetry={() => void load()} />
        ) : tableRows.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No verification sessions"
            message="Start a physical verification to reconcile assets against the register."
            action={<Button type="button" onClick={startNew}>+ New verification</Button>}
          />
        ) : (
          <DataTable
            columns={[
              { key: "session", label: "Session ID", render: (r) => <span title={String(r.id)}>{String(r.session)}</span> },
              { key: "date", label: "Date" },
              { key: "location", label: "Location" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={tableRows}
            rowLinkKey="id"
            rowLinkPrefix="/assets/verification/"
            pageSize={20}
            sortable
          />
        )}
      </div>

      {isAtSessionLimit(rows.length) ? (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>Showing the latest {SESSION_LIMIT} sessions.</p>
      ) : null}

      <ConfirmDialog
        open={create.open}
        title="Start a new verification session?"
        description={<>This opens a GFR physical-verification session at <b>{location || "—"}</b> for stock-take and reconciliation. Add a note describing the scope.</>}
        confirmLabel="Create session"
        requireReason
        reasonLabel="Scope / notes"
        busy={create.busy}
        errorMessage={create.error}
        onConfirm={create.confirm}
        onCancel={create.cancel}
      />
    </>
  );
}
