"use client";

import { todayIST } from "@/lib/formatters";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toHumanError } from "@/lib/messages";
import { Button } from "@/app/_components/ds";
import { RemoteSearchSelect, type RemoteOption } from "../../_components/RemoteSearchSelect";

type POOption = { id: string; poNo: string; vendor?: string; vendorId?: string };
type POItem = { ref: string; itemCode: string; quantity: number; unit: string };

type GRNLine = {
  poItemRef: string;
  itemCode: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
  unit: string;
};

type LoadState = "loading" | "ready" | "error";

function emptyLine(): GRNLine {
  return { poItemRef: "", itemCode: "", orderedQty: 0, receivedQty: 0, acceptedQty: 0, unit: "nos" };
}

// DOM-002 — this form only records RECEIPT (what came in against a PO); it does
// not collect an inspection verdict (a separate second-actor step on the detail
// page). GAP-PROCUREMENT-GRN-NEW-01..05 additions:
//  - 01: grnNo is NOT generated client-side anymore; the server issues a gapless
//        sequence number and the body omits grnNo entirely.
//  - 02: no PO/vendor auto-select; selecting a PO lays out one row per PO item
//        with ordered prefilled but received/accepted blank, and submit is
//        blocked when nothing was received.
//  - 03: received/accepted quantities are validated (non-negative integers,
//        accepted<=received, received<=ordered) with per-row messages; unit
//        comes from the PO item, not a hard-coded "nos".
//  - 04: Vendor is DERIVED from the selected PO (read-only) so it can never
//        diverge from the PO's vendor; the PO is chosen through a server-side
//        search combobox (?q=) so POs beyond the first page are reachable, and
//        the server rejects a vendor/PO mismatch (commands.ts VENDOR_PO_MISMATCH).
//  - 05: load failures surface an inline alert with Retry instead of a stuck
//        "Loading…" placeholder.
export function CreateGRNForm() {
  const router = useRouter();
  const t = useTranslations("procurement.poPicker");
  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [selectedPo, setSelectedPo] = useState<RemoteOption | null>(null);
  const poById = useRef(new Map<string, POOption>());
  const [poId, setPoId] = useState("");
  const [poRef, setPoRef] = useState("");
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [receivedDate, setReceivedDate] = useState(todayIST());
  const [lines, setLines] = useState<GRNLine[]>([emptyLine()]);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  // GAP-PROCUREMENT-GRN-NEW-05 — explicit load state for the PO's items.
  const [poItemsLoad, setPoItemsLoad] = useState<LoadState>("ready");

  const nextLineRowId = useRef(0);
  const [lineRowIds, setLineRowIds] = useState<number[]>(() => [nextLineRowId.current++]);
  const lineKeyFor = (idx: number) => lineRowIds[idx] ?? idx;

  // GAP-PROCUREMENT-GRN-NEW-04 — PO search is server-side (?q=), 25 per query.
  const searchPos = useCallback(async (q: string, signal: AbortSignal): Promise<RemoteOption[]> => {
    const qs = new URLSearchParams({ limit: "25" });
    if (q) qs.set("q", q);
    const res = await fetch(`/api/proxy/v1/procurement/pos?${qs.toString()}`, { signal });
    if (!res.ok) throw new Error("po search failed");
    const body = await res.json() as { data?: POOption[] } | POOption[];
    const rows = (Array.isArray(body) ? body : (body.data ?? [])).filter((p) => p.id && p.poNo);
    for (const p of rows) poById.current.set(p.id, p);
    return rows.map((p) => ({ id: p.id, label: p.poNo, ...(p.vendor ? { hint: p.vendor } : {}) }));
  }, []);

  function clearPo() {
    setSelectedPo(null);
    setPoId("");
    setPoRef("");
    setVendorId("");
    setVendorName("");
    setPoItems([]);
    setPoItemsLoad("ready");
    setLines([emptyLine()]);
    setLineRowIds([nextLineRowId.current++]);
  }

  function onPoChange(opt: RemoteOption | null) {
    if (!opt) { clearPo(); return; }
    const po = poById.current.get(opt.id);
    if (!po) return;
    setSelectedPo(opt);
    void selectPo(po);
  }

  async function selectPo(po: POOption) {
    setPoId(po.id);
    setPoRef(po.poNo);
    // GAP-PROCUREMENT-GRN-NEW-04 — the vendor is derived from the PO (never
    // chosen separately), so a GRN cannot be raised against the wrong vendor.
    setVendorName(po.vendor ?? "");
    setVendorId(po.vendorId ?? "");
    setPoItemsLoad("loading");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/pos/${po.id}`);
      if (!res.ok) { setPoItems([]); setPoItemsLoad("error"); return; }
      const detail = await res.json() as Record<string, unknown>;
      // PO vendorId may only come back on the detail, not the list row.
      if (!po.vendorId && typeof detail.vendorId === "string") {
        setVendorId(detail.vendorId);
      }
      const raw = Array.isArray(detail.items) ? detail.items
        : Array.isArray(detail.lineItems) ? detail.lineItems : [];
      const items: POItem[] = raw
        .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
        .map((i) => ({
          ref: String(i.poItemRef ?? i.id ?? `procurement_po_item:${po.id}:${String(i.itemCode ?? "")}`),
          itemCode: String(i.itemCode ?? ""),
          quantity: typeof i.quantity === "number" ? i.quantity : 0,
          unit: typeof i.unit === "string" && i.unit ? i.unit : "nos",
        }))
        .filter((i) => i.itemCode);
      setPoItems(items);
      setPoItemsLoad("ready");
      // GAP-PROCUREMENT-GRN-NEW-02 — one row per PO item, ordered prefilled but
      // received/accepted left blank (0) so the clerk must enter them.
      if (items.length > 0) {
        setLines(items.map((it) => ({ poItemRef: it.ref, itemCode: it.itemCode, orderedQty: it.quantity, receivedQty: 0, acceptedQty: 0, unit: it.unit })));
        setLineRowIds(items.map(() => nextLineRowId.current++));
      } else {
        setLines([emptyLine()]);
        setLineRowIds([nextLineRowId.current++]);
      }
    } catch {
      setPoItems([]);
      setPoItemsLoad("error");
    }
  }

  function updateLine(idx: number, patch: Partial<GRNLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((p) => [...p, emptyLine()]);
    setLineRowIds((ids) => [...ids, nextLineRowId.current++]);
  }
  function removeLine(idx: number) {
    setLines((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));
    setLineRowIds((ids) => (ids.length > 1 ? ids.filter((_, i) => i !== idx) : ids));
  }
  function pickItem(idx: number, ref: string) {
    const it = poItems.find((p) => p.ref === ref);
    updateLine(idx, it ? { poItemRef: it.ref, itemCode: it.itemCode, orderedQty: it.quantity, unit: it.unit } : { poItemRef: ref });
  }

  // GAP-PROCUREMENT-GRN-NEW-03 — explicit quantity validation (shared shape with
  // the server's assertQtyValid). Returns per-row messages.
  function validateLines(valid: GRNLine[]): Record<number, string> {
    const errs: Record<number, string> = {};
    valid.forEach((l, idx) => {
      if (!Number.isInteger(l.receivedQty) || !Number.isInteger(l.acceptedQty) || l.receivedQty < 0 || l.acceptedQty < 0) {
        errs[idx] = `Quantities for ${l.itemCode || `row ${idx + 1}`} must be non-negative whole numbers.`;
      } else if (l.acceptedQty > l.receivedQty) {
        errs[idx] = `Accepted (${l.acceptedQty}) cannot exceed received (${l.receivedQty}) for ${l.itemCode || `row ${idx + 1}`}.`;
      } else if (l.orderedQty > 0 && l.receivedQty > l.orderedQty) {
        errs[idx] = `Received (${l.receivedQty}) cannot exceed ordered (${l.orderedQty}) for ${l.itemCode || `row ${idx + 1}`}.`;
      }
    });
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRowErrors({});
    const valid = lines.filter((l) => l.poItemRef.trim() && l.itemCode.trim());
    if (!vendorId || !poRef.trim() || valid.length === 0) {
      setStatus("error");
      setMessage("Vendor, purchase order and at least one line item are required.");
      return;
    }
    // GAP-PROCUREMENT-GRN-NEW-02 — a GRN with nothing received is not a receipt.
    if (valid.every((l) => l.receivedQty <= 0)) {
      setStatus("error");
      setMessage("Enter the received quantity for at least one item before recording the GRN.");
      return;
    }
    const errs = validateLines(valid);
    if (Object.keys(errs).length > 0) {
      setRowErrors(errs);
      setStatus("error");
      setMessage("Please correct the highlighted quantities.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    // GAP-PROCUREMENT-GRN-NEW-01 — no client-generated grnNo; the server issues it.
    const body = {
      poRef: poRef.trim(),
      vendorId,
      receivedDate,
      items: valid.map((l) => ({
        poItemRef: l.poItemRef.trim(),
        itemCode: l.itemCode.trim(),
        orderedQty: Math.max(0, l.orderedQty),
        receivedQty: Math.max(0, l.receivedQty),
        acceptedQty: Math.max(0, l.acceptedQty),
        unit: l.unit || "nos",
      })),
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/grns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        let errCode = "";
        try { errCode = (JSON.parse(text) as { code?: string }).code ?? ""; } catch { /* non-JSON error body */ }
        if (errCode === "OVER_RECEIPT") {
          setStatus("error");
          setMessage(t("overReceipt"));
          return;
        }
        const human = toHumanError("save", { area: "goods receipt note" });
        setStatus("error");
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      let parsed: { id?: string } = {};
      try { parsed = JSON.parse(text) as { id?: string }; } catch { /* ignore */ }
      setStatus("accepted");
      setMessage("GRN recorded as received — awaiting inspection by a separate officer before the three-way match is computed.");
      router.push(parsed.id ? `/procurement/grn/${parsed.id}` : "/procurement/grn");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 860 }} noValidate>
      <div className="fields">
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="grn-po">Purchase order *</label>
          <RemoteSearchSelect
            inputId="grn-po"
            value={selectedPo}
            onChange={onPoChange}
            search={searchPos}
            required
            describedBy={status === "error" ? "grn-form-message" : undefined}
            labels={{
              placeholder: t("placeholder"), loading: t("loading"), empty: t("empty"),
              error: t("error"), retry: t("retry"), clear: t("clear"),
            }}
          />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Vendor</span>
          {/* GAP-PROCUREMENT-GRN-NEW-04 — read-only, derived from the PO. */}
          <span>{vendorName || (vendorId ? t("vendorFromPo") : t("vendorPending"))}</span>
        </div>
        <label className="field" htmlFor="grn-received-date" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Received date</span>
          <input id="grn-received-date" type="date" max={todayIST()} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} style={{ minHeight: 44 }} />
        </label>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "8px 0 0" }}>
        <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>Received line items</legend>
        {poItemsLoad === "error" ? (
          <p role="alert" style={{ fontSize: "0.875rem", color: "#b45309", marginTop: 0 }}>
            Couldn&apos;t load the PO&apos;s items — you can still enter them manually below.
          </p>
        ) : null}
        <div style={{ overflowX: "auto" }}>
          <table className="tbl-editor" style={{ minWidth: 760, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col">PO item</th>
                <th scope="col">Item code</th>
                <th scope="col">Unit</th>
                <th scope="col" className="num">Ordered</th>
                <th scope="col" className="num">Received</th>
                <th scope="col" className="num">Accepted</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={lineKeyFor(idx)}>
                  <td>
                    <label className="sr-only" htmlFor={`g-item-${idx}`}>PO item, row {idx + 1}</label>
                    {poItems.length > 0 ? (
                      <select id={`g-item-${idx}`} value={l.poItemRef} onChange={(e) => pickItem(idx, e.target.value)} required aria-required="true" style={{ minHeight: 40, width: "100%" }}>
                        <option value="">Select item…</option>
                        {poItems.map((it) => <option key={it.ref} value={it.ref}>{it.itemCode}</option>)}
                      </select>
                    ) : (
                      <input id={`g-item-${idx}`} value={l.poItemRef} onChange={(e) => updateLine(idx, { poItemRef: e.target.value })} placeholder="PO item ref" required aria-required="true" style={{ minHeight: 40, width: "100%" }} />
                    )}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`g-code-${idx}`}>Item code, row {idx + 1}</label>
                    <input id={`g-code-${idx}`} value={l.itemCode} onChange={(e) => updateLine(idx, { itemCode: e.target.value })} required aria-required="true" aria-describedby={rowErrors[idx] ? `g-row-err-${idx}` : (status === "error" ? "grn-form-message" : undefined)} style={{ minHeight: 40, width: "100%" }} />
                    {rowErrors[idx] ? <span id={`g-row-err-${idx}`} role="alert" style={{ display: "block", fontSize: "0.75rem", color: "#b91c1c" }}>{rowErrors[idx]}</span> : null}
                  </td>
                  <td>{l.unit}</td>
                  <td className="num">{l.orderedQty}</td>
                  <td className="num"><input type="number" min={0} step={1} aria-label={`Received qty row ${idx + 1}`} value={l.receivedQty} onChange={(e) => updateLine(idx, { receivedQty: Number(e.target.value) })} style={{ minHeight: 40, width: 80, textAlign: "end" }} /></td>
                  <td className="num"><input type="number" min={0} step={1} aria-label={`Accepted qty row ${idx + 1}`} value={l.acceptedQty} onChange={(e) => updateLine(idx, { acceptedQty: Number(e.target.value) })} style={{ minHeight: 40, width: 80, textAlign: "end" }} /></td>
                  <td>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(idx)} disabled={lines.length <= 1} aria-label={`Remove line item ${idx + 1}`} style={{ minHeight: 40 }}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={addLine} style={{ marginTop: 10, minHeight: 40 }}>+ Add line item</Button>
      </fieldset>

      <div role="status" aria-live="polite">
        {message ? (
          <p id="grn-form-message" role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Record GRN"}
        </Button>
        <Link href="/procurement/grn" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
