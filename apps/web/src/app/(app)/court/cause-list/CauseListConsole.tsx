"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, StatusPill } from "@/app/_components/ds";
import type { CauseListItem, Court, CourtCase } from "../_data/types";
import { fmtDate, humanize, todayIso } from "../_data/format";
import {
  addCauseListItem,
  createCauseList,
  fetchCauseListByCourtDate,
  fetchCauseListItems,
} from "../_data/client";

const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "left",
};
const fieldStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
};

/**
 * The court-service exposes GET /cause-lists?courtId&listDate (a court has
 * exactly ONE cause-list per day, deterministic id) so this console looks up
 * an existing list on court/date change and re-opens it rather than
 * re-generating a duplicate (GAP-COURT-CAUSE-LIST-02). Courts are chosen by
 * NAME from the registry (GAP-COURT-CAUSE-LIST-01), not inferred from the case
 * list; a court with zero cases is still selectable.
 */
export function CauseListConsole({
  cases,
  casesSource,
  courts,
  courtsSource,
}: {
  cases: CourtCase[];
  casesSource: "api" | "error";
  courts: Court[];
  courtsSource: "api" | "error";
}) {
  const [courtId, setCourtId] = useState("");
  const [listDate, setListDate] = useState(todayIso());
  const [causeListId, setCauseListId] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [items, setItems] = useState<CauseListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fallback only when the registry couldn't be reached: infer courts from the
  // case list, but still label by name (never a bare UUID).
  const inferredCourts = useMemo<Court[]>(() => {
    const seen = new Map<string, CourtCase>();
    for (const c of cases) {
      if (c.courtId && !seen.has(c.courtId)) seen.set(c.courtId, c);
    }
    return [...seen.entries()].map(([id, sample]) => ({
      id,
      name: sample.title ? `Court of “${sample.title.slice(0, 24)}”` : `Court ${id.slice(0, 8)}`,
      courtType: null,
      establishmentCode: null,
    }));
  }, [cases]);

  const courtOptions = courts.length > 0 ? courts : inferredCourts;
  const usingFallback = courts.length === 0 && inferredCourts.length > 0;

  const casesForCourt = useMemo(
    () => (courtId ? cases.filter((c) => c.courtId === courtId) : cases),
    [cases, courtId],
  );

  // Read initial selection from the URL (deep link / reload).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const c = sp.get("courtId") ?? "";
    const d = sp.get("date") ?? "";
    if (c) setCourtId(c);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setListDate(d);
  }, []);

  const syncUrl = useCallback((c: string, d: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (c) url.searchParams.set("courtId", c);
    else url.searchParams.delete("courtId");
    if (d) url.searchParams.set("date", d);
    else url.searchParams.delete("date");
    window.history.replaceState(null, "", url.toString());
  }, []);

  // On court/date change, look up an existing list and load its items.
  useEffect(() => {
    let cancelled = false;
    setCauseListId(null);
    setExists(false);
    setItems([]);
    if (!courtId || !listDate) return;
    (async () => {
      try {
        const ref = await fetchCauseListByCourtDate(courtId, listDate);
        if (cancelled) return;
        if (ref) {
          setCauseListId(ref.id);
          setExists(true);
          setItems(await fetchCauseListItems(ref.id));
        }
      } catch {
        /* leave as "not found"; generating will create it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courtId, listDate]);

  async function generateOrOpen() {
    if (!courtId || !listDate) return;
    // Already loaded → nothing to do (button reads "Open list" / disabled).
    if (causeListId && exists) {
      setItems(await fetchCauseListItems(causeListId));
      return;
    }
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      const ref = await createCauseList({ courtId, listDate });
      if (!ref.id) throw new Error("The service accepted the list but returned no id.");
      setCauseListId(ref.id);
      setExists(true);
      setItems(await fetchCauseListItems(ref.id));
      setToast(`Cause list ready for ${fmtDate(listDate)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the cause list.");
    } finally {
      setBusy(false);
    }
  }

  async function reloadItems(id: string) {
    try {
      setItems(await fetchCauseListItems(id));
    } catch {
      /* keep current on reload failure */
    }
  }

  const courtName = courtOptions.find((c) => c.id === courtId)?.name;

  return (
    <>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}
      {error && (
        <div className="alert" role="alert" style={{ borderColor: "#fca5a5", color: "#b91c1c" }}>
          ⚠ {error}
        </div>
      )}
      {casesSource === "error" && (
        <div className="alert" role="status" style={{ borderColor: "#fca5a5" }}>
          The case registry couldn’t be reached, so the case picker below may be incomplete. Court selection still works.
        </div>
      )}

      <Card title="Generate a cause list" padding>
        {courtsSource === "error" && courtOptions.length === 0 ? (
          <EmptyState
            icon="📅"
            title="Court list unavailable"
            message="The court registry couldn't be reached. Try again shortly."
          />
        ) : (
          <>
            {usingFallback && (
              <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 8 }}>
                Court registry couldn’t be reached — showing courts inferred from registered cases.
              </p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <select
                aria-label="Court"
                value={courtId}
                onChange={(e) => {
                  setCourtId(e.target.value);
                  syncUrl(e.target.value, listDate);
                }}
                style={{ ...fieldStyle, minWidth: 240 }}
              >
                <option value="">Select a court…</option>
                {courtOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.courtType ? ` · ${humanize(c.courtType)}` : ""}
                  </option>
                ))}
              </select>
              <input
                type="date"
                aria-label="List date"
                value={listDate}
                onChange={(e) => {
                  setListDate(e.target.value);
                  syncUrl(courtId, e.target.value);
                }}
                style={fieldStyle}
              />
              <Button
                variant="primary"
                disabled={busy || !courtId || !listDate || (exists && causeListId !== null)}
                onClick={() => void generateOrOpen()}
              >
                {busy
                  ? "Generating…"
                  : exists && causeListId
                    ? "List ready"
                    : "Generate list"}
              </Button>
              {causeListId && (
                <StatusPill status="active" label={exists ? "Opened" : `List ${causeListId.slice(0, 8)}`} />
              )}
            </div>
          </>
        )}
      </Card>

      {causeListId && (
        <>
          <AddItemForm
            causeListId={causeListId}
            cases={casesForCourt}
            existingItems={items}
            nextItemNumber={items.length + 1}
            onDone={async (msg) => {
              setToast(msg);
              setError(null);
              await reloadItems(causeListId);
            }}
            onError={(err) =>
              setError(err instanceof Error ? err.message : "Could not list the case.")
            }
          />

          <Card
            title={`Listed items (${items.length})${courtName ? ` · ${courtName}` : ""}`}
            padding
          >
            {items.length === 0 ? (
              <EmptyState
                icon="📄"
                title="No items listed yet"
                message="Add the first case to this cause list above."
              />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="tbl court-stack" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={labelStyle}>Item</th>
                      <th style={labelStyle}>Case</th>
                      <th style={labelStyle}>Type</th>
                      <th style={labelStyle}>Stage</th>
                      <th style={labelStyle}>Slot</th>
                      <th style={labelStyle}>Courtroom</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...items]
                      .sort((a, b) => (a.itemNumber ?? 0) - (b.itemNumber ?? 0))
                      .map((it) => {
                        const c = cases.find((x) => x.id === it.caseId);
                        return (
                          <tr key={it.id}>
                            <td data-label="Item" style={mono}>
                              {it.itemNumber ?? "—"}
                            </td>
                            <td data-label="Case">
                              <div style={{ fontWeight: 600 }}>{c?.title ?? "Case"}</div>
                              <div style={{ ...mono, fontSize: 12, color: "var(--ink2)" }}>
                                {c?.cnrNumber ?? it.caseId.slice(0, 8)}
                              </div>
                            </td>
                            <td data-label="Type">{c ? humanize(c.caseType) : "—"}</td>
                            <td data-label="Stage">{c?.stage ? humanize(c.stage) : "—"}</td>
                            {/* GAP-COURT-CAUSE-LIST-03: slot shown VERBATIM (no humanize). */}
                            <td data-label="Slot" style={mono}>
                              {it.slot ?? "—"}
                            </td>
                            <td data-label="Courtroom">{it.courtroom ?? "—"}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function AddItemForm({
  causeListId,
  cases,
  existingItems,
  nextItemNumber,
  onDone,
  onError,
}: {
  causeListId: string;
  cases: CourtCase[];
  existingItems: CauseListItem[];
  nextItemNumber: number;
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown) => void;
}) {
  const [caseId, setCaseId] = useState("");
  const [itemNumber, setItemNumber] = useState(String(nextItemNumber));
  const [slot, setSlot] = useState("");
  const [courtroom, setCourtroom] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const usedItemNumbers = useMemo(
    () => new Set(existingItems.map((it) => it.itemNumber).filter((n): n is number => n != null)),
    [existingItems],
  );

  async function add() {
    setLocalError(null);
    // GAP-COURT-CAUSE-LIST-03: validate item number is a positive integer and
    // not already used, and normalise slot/courtroom (uppercase + trim) so
    // "am 1" and "AM-1" don't diverge.
    const n = Number(itemNumber);
    if (!Number.isInteger(n) || n < 1) {
      setLocalError("Item number must be a whole number of 1 or more.");
      return;
    }
    if (usedItemNumbers.has(n)) {
      setLocalError(`Item number ${n} is already used on this cause list.`);
      return;
    }
    const normSlot = slot.trim().toUpperCase().replace(/\s+/g, "-");
    const normCourtroom = courtroom.trim().toUpperCase();
    if (!caseId || !normSlot || !normCourtroom) {
      setLocalError("Pick a case and enter a slot and courtroom.");
      return;
    }
    setBusy(true);
    try {
      await addCauseListItem(causeListId, {
        caseId,
        itemNumber: n,
        slot: normSlot,
        courtroom: normCourtroom,
      });
      setCaseId("");
      setSlot("");
      setCourtroom("");
      setItemNumber(String(nextItemNumber + 1));
      await onDone("Case listed onto the cause list.");
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="List a case" padding>
      {cases.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="No cases to list"
          message="No cases were found for this court. Register a case first, or pick another court."
        />
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <select
              aria-label="Case"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              style={{ ...fieldStyle, minWidth: 240 }}
            >
              <option value="">Select a case…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c.title ?? "Case").slice(0, 30)} — {c.cnrNumber || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              aria-label="Item number"
              value={itemNumber}
              onChange={(e) => setItemNumber(e.target.value)}
              style={{ ...fieldStyle, width: 90, ...mono, textAlign: "right" }}
            />
            <input
              aria-label="Slot"
              placeholder="Slot (e.g. AM-1)"
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              style={{ ...fieldStyle, width: 120 }}
            />
            <input
              aria-label="Courtroom"
              placeholder="Courtroom"
              value={courtroom}
              onChange={(e) => setCourtroom(e.target.value)}
              style={{ ...fieldStyle, width: 140 }}
            />
            <Button variant="primary" disabled={busy} onClick={() => void add()}>
              {busy ? "Listing…" : "List case"}
            </Button>
          </div>
          {localError && (
            <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: "6px 0 0" }}>
              {localError}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
