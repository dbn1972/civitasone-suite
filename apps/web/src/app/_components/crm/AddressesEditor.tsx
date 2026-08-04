"use client";
/**
 * AddressesEditor — CM-001. Manage the multiple addresses on a contact or
 * account (billing / shipping / registered / office / home / other), with
 * exactly one marked primary. Each row is created (POST), updated (PUT) or
 * deleted (DELETE) individually; a row is blocked from saving until it has a
 * line 1, city and a valid 6-digit PIN. Marking a row primary clears the flag
 * on the others in the editor so the "one primary" rule is obvious. Deletion is
 * governed via ConfirmDialog; a failed load shows the saved-info badge.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  ADDRESS_TYPES,
  ADDRESS_TYPE_LABELS,
  type Address,
  type AddressType,
  type OwnerType,
  type AaSource,
} from "@/lib/crm/activityAccount";

interface Row extends Address {
  key: string;
}
let SEQ = 0;
function toRow(a: Address): Row {
  return { ...a, key: a.id ?? `new-${SEQ++}` };
}

const PIN_RE = /^\d{6}$/;
function rowValid(r: Row): boolean {
  return r.line1.trim().length > 0 && r.city.trim().length > 0 && PIN_RE.test(r.pincode.trim());
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface Props {
  ownerType: OwnerType;
  ownerId: string;
}

export function AddressesEditor({ ownerType, ownerId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getAddresses(ownerType, ownerId);
    if (!isLive()) return;
    setRows(data.map(toRow));
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerType, ownerId]);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) {
          // Enforce a single primary in the editor.
          return patch.isPrimary ? { ...r, isPrimary: false } : r;
        }
        return { ...r, ...patch };
      }),
    );
  }

  function addAddress() {
    setRows((prev) => [
      ...prev,
      toRow({
        ownerType,
        ownerId,
        addressType: "office",
        line1: "",
        line2: "",
        city: "",
        state: "",
        pincode: "",
        country: "India",
        isPrimary: prev.length === 0,
      }),
    ]);
  }

  async function saveRow(row: Row) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      setError("Each address needs a line 1, a city and a valid 6-digit PIN.");
      return;
    }
    const body: Address = {
      ...(row.id ? { id: row.id } : {}),
      ownerType,
      ownerId,
      addressType: row.addressType,
      line1: row.line1.trim(),
      line2: row.line2.trim(),
      city: row.city.trim(),
      state: row.state.trim(),
      pincode: row.pincode.trim(),
      country: row.country.trim() || "India",
      isPrimary: row.isPrimary,
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateAddress(row.id, body);
      else await createAddress(body);
      setMessage("Address saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the address.");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmDelete(row: Row) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    setBusyKey(row.key);
    setError("");
    try {
      await deleteAddress(row.id);
      setMessage("Address deleted.");
      setConfirmKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the address.");
    } finally {
      setBusyKey(null);
    }
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Addresses</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        {source === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading addresses…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon="📮" title="No addresses yet" message="Add a billing, shipping or office address below." />
        ) : (
          rows.map((row, i) => (
            <fieldset key={row.key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "grid", gap: 10, margin: 0 }}>
              <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", padding: "0 6px" }}>
                Address {i + 1}{row.isPrimary ? " · Primary" : ""}
              </legend>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label htmlFor={`${row.key}-type`} style={labelStyle}>Type</label>
                  <select
                    id={`${row.key}-type`}
                    aria-label={`Address type for address ${i + 1}`}
                    value={row.addressType}
                    onChange={(e) => update(row.key, { addressType: e.target.value as AddressType })}
                    style={inputStyle}
                  >
                    {ADDRESS_TYPES.map((t) => <option key={t} value={t}>{ADDRESS_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "end", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={row.isPrimary}
                    aria-label={`Mark address ${i + 1} as primary`}
                    onChange={(e) => update(row.key, { isPrimary: e.target.checked })}
                  />
                  Primary address
                </label>
              </div>
              <div>
                <label htmlFor={`${row.key}-l1`} style={labelStyle}>Line 1</label>
                <input id={`${row.key}-l1`} aria-label={`Line 1 for address ${i + 1}`} value={row.line1} onChange={(e) => update(row.key, { line1: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label htmlFor={`${row.key}-l2`} style={labelStyle}>Line 2</label>
                <input id={`${row.key}-l2`} aria-label={`Line 2 for address ${i + 1}`} value={row.line2} onChange={(e) => update(row.key, { line2: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label htmlFor={`${row.key}-city`} style={labelStyle}>City</label>
                  <input id={`${row.key}-city`} aria-label={`City for address ${i + 1}`} value={row.city} onChange={(e) => update(row.key, { city: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label htmlFor={`${row.key}-state`} style={labelStyle}>State</label>
                  <input id={`${row.key}-state`} aria-label={`State for address ${i + 1}`} value={row.state} onChange={(e) => update(row.key, { state: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label htmlFor={`${row.key}-pin`} style={labelStyle}>PIN</label>
                  <input
                    id={`${row.key}-pin`}
                    aria-label={`PIN code for address ${i + 1}`}
                    value={row.pincode}
                    onChange={(e) => update(row.key, { pincode: e.target.value })}
                    inputMode="numeric"
                    aria-invalid={row.pincode.trim() && !PIN_RE.test(row.pincode.trim()) ? true : undefined}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn primary" disabled={busyKey === row.key} onClick={() => void saveRow(row)} style={{ minHeight: 40 }}>
                  {busyKey === row.key ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn danger" aria-label={`Delete address ${i + 1}`} disabled={busyKey === row.key} onClick={() => setConfirmKey(row.key)} style={{ minHeight: 40 }}>
                  Delete
                </button>
              </div>
            </fieldset>
          ))
        )}

        <div>
          <button type="button" className="btn" onClick={addAddress} style={{ minHeight: 44 }}>
            + Add address
          </button>
        </div>
        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        title="Delete this address?"
        description="The address will be removed from this record. This cannot be undone."
        confirmLabel="Delete address"
        danger
        busy={busyKey !== null && confirmRow?.key === busyKey}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void confirmDelete(confirmRow)}
      />
    </div>
  );
}
