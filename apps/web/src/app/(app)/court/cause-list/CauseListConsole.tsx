"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, StatusPill } from "@/app/_components/ds";
import type { CauseListItem, CourtCase } from "../_data/types";
import { fmtDate, humanize, todayIso } from "../_data/format";
import { addCauseListItem, createCauseList, fetchCauseListItems } from "../_data/client";

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
 * The court-service exposes no "list cause-lists" read endpoint — a cause list
 * is created, then cases are listed onto it and its items read back. So this
 * console is a single stateful workflow: generate a list for a court/day, then
 * add items and view them. (TODO: swap to a persisted list picker if the
 * service later adds GET /cause-lists.)
 */
export function CauseListConsole({
  cases,
  casesSource,
}: {
  cases: CourtCase[];
  casesSource: "api" | "error";
}) {
  const [courtId, setCourtId] = useState("");
  const [listDate, setListDate] = useState(todayIso());
  const [causeListId, setCauseListId] = useState<string | null>(null);
  const [items, setItems] = useState<CauseListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Distinct courts present in the registry, so an operator can pick a valid
  // courtId without typing a UUID by hand.
  const courts = useMemo(() => {
    const seen = new Map<string, CourtCase>();
    for (const c of cases) {
      if (c.courtId && !seen.has(c.courtId)) seen.set(c.courtId, c);
    }
    return [...seen.entries()].map(([id, sample]) => ({ id, sample }));
  }, [cases]);

  const casesForCourt = useMemo(
    () => (courtId ? cases.filter((c) => c.courtId === courtId) : cases),
    [cases, courtId],
  );

  async function generate() {
    if (!courtId || !listDate) return;
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      const ref = await createCauseList({ courtId, listDate });
      if (!ref.id) throw new Error("The service accepted the list but returned no id.");
      setCauseListId(ref.id);
      setItems(await fetchCauseListItems(ref.id));
      setToast(`Cause list generated for ${fmtDate(listDate)}.`);
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

      <Card title="Generate a cause list" padding>
        {casesSource === "error" && courts.length === 0 ? (
          <EmptyState
            icon="📅"
            title="Court list unavailable"
            message="The case registry couldn't be reached, so no court could be pre-filled. Try again shortly."
          />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <select
              aria-label="Court"
              value={courtId}
              onChange={(e) => {
                setCourtId(e.target.value);
                setCauseListId(null);
                setItems([]);
              }}
              style={{ ...fieldStyle, minWidth: 220 }}
            >
              <option value="">Select a court…</option>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.sample.title ? `${c.sample.title.slice(0, 28)} — ` : ""}
                  {c.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label="List date"
              value={listDate}
              onChange={(e) => setListDate(e.target.value)}
              style={fieldStyle}
            />
            <button
              type="button"
              className="btn primary"
              disabled={busy || !courtId || !listDate}
              onClick={() => void generate()}
            >
              {busy ? "Generating…" : "Generate list"}
            </button>
            {causeListId && (
              <StatusPill status="active" label={`List ${causeListId.slice(0, 8)}`} />
            )}
          </div>
        )}
      </Card>

      {causeListId && (
        <>
          <AddItemForm
            causeListId={causeListId}
            cases={casesForCourt}
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

          <Card title={`Listed items (${items.length})`} padding>
            {items.length === 0 ? (
              <EmptyState
                icon="📄"
                title="No items listed yet"
                message="Add the first case to this cause list above."
              />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="tbl" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={labelStyle}>Item</th>
                      <th style={labelStyle}>Case</th>
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
                            <td style={mono}>{it.itemNumber ?? "—"}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{c?.title ?? "Case"}</div>
                              <div style={{ ...mono, fontSize: 12, color: "var(--ink2)" }}>
                                {c?.cnrNumber ?? it.caseId.slice(0, 8)}
                              </div>
                            </td>
                            <td>{humanize(it.slot)}</td>
                            <td>{it.courtroom ?? "—"}</td>
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
  nextItemNumber,
  onDone,
  onError,
}: {
  causeListId: string;
  cases: CourtCase[];
  nextItemNumber: number;
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown) => void;
}) {
  const [caseId, setCaseId] = useState("");
  const [itemNumber, setItemNumber] = useState(String(nextItemNumber));
  const [slot, setSlot] = useState("");
  const [courtroom, setCourtroom] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!caseId || !slot.trim() || !courtroom.trim()) return;
    setBusy(true);
    try {
      await addCauseListItem(causeListId, {
        caseId,
        itemNumber: Number(itemNumber) || nextItemNumber,
        slot: slot.trim(),
        courtroom: courtroom.trim(),
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
          message="No cases were found for this court. Register a case first."
        />
      ) : (
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
          <button
            type="button"
            className="btn primary"
            disabled={busy || !caseId || !slot.trim() || !courtroom.trim()}
            onClick={() => void add()}
          >
            {busy ? "Listing…" : "List case"}
          </button>
        </div>
      )}
    </Card>
  );
}
