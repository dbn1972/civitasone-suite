"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { toHumanError } from "@/lib/messages";
import { Button } from "@/app/_components/ds";

type VendorOption = { id: string; name: string };
type VendorsState = "loading" | "ready" | "error";

export function CreateContractForm() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorsState, setVendorsState] = useState<VendorsState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [vendorId, setVendorId] = useState("");
  const [contractNo, setContractNo] = useState("");
  const [title, setTitle] = useState("");
  // GAP-PROCUREMENT-CONTRACTS-NEW-05: value is a STRING parsed with
  // rupeesToMinorString (exact paise, no float math). "" default means "no
  // value entered yet" so the ₹ hint is hidden until the clerk types.
  const [value, setValue] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiry, setExpiry] = useState("");
  const [poRef, setPoRef] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ vendor?: string; expiry?: string; value?: string; contractNo?: string }>({});

  useEffect(() => {
    const controller = new AbortController();
    setVendorsState("loading");
    void (async () => {
      try {
        // GAP-PROCUREMENT-CONTRACTS-NEW-05: raise the cap from 100 to 500 so
        // vendors beyond the first 100 are reachable (the create form needs the
        // full empanelled list, not a truncated page).
        const res = await fetch("/api/proxy/v1/procurement/vendors?limit=500", { signal: controller.signal });
        if (!res.ok) {
          setVendorsState("error");
          return;
        }
        const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        const clean = rows.filter((v) => v.id && v.name);
        setVendors(clean);
        setVendorsState("ready");
        // GAP-PROCUREMENT-CONTRACTS-NEW-01: do NOT auto-select the first vendor
        // — the field stays blank so a hurried clerk cannot register a contract
        // against an unintended vendor. The placeholder below forces a choice.
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // GAP-PROCUREMENT-CONTRACTS-NEW-02: surface the failure instead of
        // swallowing it and showing "Loading vendors…" forever.
        setVendorsState("error");
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  const retryVendors = useCallback(() => setReloadKey((k) => k + 1), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextFieldErrors: typeof fieldErrors = {};
    const minor = rupeesToMinorString(value);
    if (!vendorId) nextFieldErrors.vendor = "Select a vendor.";
    if (!contractNo.trim()) nextFieldErrors.contractNo = "Contract number is required.";
    if (minor === null) nextFieldErrors.value = "Enter a positive contract value (up to 2 decimal places).";
    if (!expiry) nextFieldErrors.expiry = "Expiry date is required.";
    // GAP-PROCUREMENT-CONTRACTS-NEW-03: expiry must be after the start date.
    if (expiry && startDate && expiry <= startDate) {
      nextFieldErrors.expiry = "Expiry date must be after the start date.";
    }
    if (!title.trim() || Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setStatus("error");
      setMessage(
        !title.trim()
          ? "Title is required."
          : "Please correct the highlighted fields.",
      );
      return;
    }
    setFieldErrors({});
    setStatus("submitting");
    setMessage("");
    const body = {
      contractNo: contractNo.trim(),
      vendorId,
      title: title.trim(),
      // Send paise as a number; the contract DTO accepts an integer minor value.
      valueMinor: Number(minor),
      currency: "INR",
      startDate,
      expiry,
      poRef: poRef.trim() || undefined,
    };
    try {
      const res = await fetch("/api/proxy/v1/contract/contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // GAP-PROCUREMENT-CONTRACTS-NEW-03: a 409 means the contract number
        // already exists — show it on that field; otherwise the catalogued
        // generic message (never raw server text).
        if (res.status === 409) {
          setFieldErrors({ contractNo: "A contract with this number already exists." });
          setStatus("error");
          setMessage("Please correct the highlighted fields.");
          return;
        }
        const human = toHumanError("save", { area: "contract" });
        setStatus("error");
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      setStatus("accepted");
      setMessage("Contract created.");
      router.push("/procurement/contracts");
      router.refresh();
    } catch {
      const human = toHumanError("offline", { area: "contract" });
      setStatus("error");
      setMessage(`${human.what} ${human.next}`);
    }
  }

  const parsedMinor = rupeesToMinorString(value);

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 720 }} noValidate>
      <div className="fields">
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Vendor / counter-party *</span>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            required
            aria-invalid={fieldErrors.vendor ? true : undefined}
            aria-describedby={fieldErrors.vendor ? "c-vendor-err" : undefined}
            disabled={vendorsState !== "ready"}
            style={{ minHeight: 44 }}
          >
            <option value="" disabled>
              {vendorsState === "loading"
                ? "Loading vendors…"
                : vendorsState === "error"
                  ? "Couldn't load vendors"
                  : vendors.length === 0
                    ? "No vendors found"
                    : "Select a vendor…"}
            </option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          {fieldErrors.vendor ? <span id="c-vendor-err" style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.vendor}</span> : null}
          {vendorsState === "error" ? (
            <span role="alert" style={{ color: "#b91c1c", fontSize: 12, marginTop: 4 }}>
              Couldn’t load vendors.{" "}
              <button type="button" className="link" onClick={retryVendors} style={{ textDecoration: "underline" }}>Try again</button>
            </span>
          ) : null}
        </label>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-no">Contract no *</label>
          <input
            id="c-no"
            className="inp"
            value={contractNo}
            onChange={(e) => setContractNo(e.target.value)}
            required
            aria-invalid={fieldErrors.contractNo ? true : undefined}
            aria-describedby={fieldErrors.contractNo ? "c-no-err" : undefined}
            style={{ minHeight: 44 }}
          />
          {fieldErrors.contractNo ? <span id="c-no-err" style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.contractNo}</span> : null}
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-title">Title *</label>
          <input id="c-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-val">Contract value (₹) *</label>
          <input
            id="c-val"
            type="text"
            inputMode="decimal"
            className="inp"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            aria-invalid={fieldErrors.value ? true : undefined}
            aria-describedby={fieldErrors.value ? "c-val-err" : undefined}
            style={{ minHeight: 44 }}
          />
          {/* GAP-PROCUREMENT-CONTRACTS-NEW-05: show the formatted hint only when
              the typed value parses to a valid paise amount — no ₹0.00 before input. */}
          {parsedMinor !== null ? (
            <span style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }} aria-live="polite">{formatMoney(parsedMinor)}</span>
          ) : null}
          {fieldErrors.value ? <span id="c-val-err" style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.value}</span> : null}
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-po">PO reference</label>
          <input id="c-po" className="inp" value={poRef} onChange={(e) => setPoRef(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-start">Start date *</label>
          <input id="c-start" type="date" className="inp" value={startDate} onChange={(e) => setStartDate(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-exp">Expiry date *</label>
          <input
            id="c-exp"
            type="date"
            className="inp"
            value={expiry}
            min={startDate || undefined}
            onChange={(e) => setExpiry(e.target.value)}
            required
            aria-invalid={fieldErrors.expiry ? true : undefined}
            aria-describedby={fieldErrors.expiry ? "c-exp-err" : undefined}
            style={{ minHeight: 44 }}
          />
          {fieldErrors.expiry ? <span id="c-exp-err" style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.expiry}</span> : null}
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting" || vendorsState !== "ready"}>
          {status === "submitting" ? "Creating…" : "Create contract"}
        </Button>
        <Link href="/procurement/contracts" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
