"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { formatMoney, todayIST } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { toHumanError } from "@/lib/messages";
import { Button } from "@/app/_components/ds";
import { RemoteSearchSelect, type RemoteOption, type RemoteSearchState } from "../../_components/RemoteSearchSelect";

const VENDOR_SEARCH_LIMIT = 25;

export function CreateContractForm() {
  const router = useRouter();
  const t = useTranslations("procurement.vendorPicker");
  // GAP-PROCUREMENT-CONTRACTS-NEW-05: the vendor is chosen through a SERVER-SIDE
  // search combobox (?q=), not a `<select>` filled from one capped page, so a
  // vendor master of any size is reachable. No vendor is pre-selected
  // (CONTRACTS-NEW-01) and a failed search shows an error + Retry (NEW-02).
  const [vendor, setVendor] = useState<RemoteOption | null>(null);
  const vendorId = vendor?.id ?? "";
  // CONTRACTS-NEW-02: while the vendor list cannot be loaded (and none is chosen)
  // the form cannot be submitted - the officer sees the error + Retry instead.
  const [vendorSearch, setVendorSearch] = useState<RemoteSearchState>("idle");
  const [contractNo, setContractNo] = useState("");
  const [title, setTitle] = useState("");
  // GAP-PROCUREMENT-CONTRACTS-NEW-05: value is a STRING parsed with
  // rupeesToMinorString (exact paise, no float math). "" default means "no
  // value entered yet" so the hint is hidden until the clerk types.
  const [value, setValue] = useState("");
  const [startDate, setStartDate] = useState(todayIST());
  const [expiry, setExpiry] = useState("");
  const [poRef, setPoRef] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ vendor?: string; expiry?: string; value?: string; contractNo?: string }>({});

  const searchVendors = useCallback(async (q: string, signal: AbortSignal): Promise<RemoteOption[]> => {
    const qs = new URLSearchParams({ limit: String(VENDOR_SEARCH_LIMIT) });
    if (q) qs.set("q", q);
    const res = await fetch(`/api/proxy/v1/procurement/vendors?${qs.toString()}`, { signal });
    if (!res.ok) throw new Error("vendor search failed");
    const body = await res.json() as { data?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    return rows.filter((v) => v.id && v.name).map((v) => ({ id: v.id, label: v.name }));
  }, []);

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
      router.push("/contracts/list");
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
        <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-vendor">Vendor / counter-party *</label>
          <RemoteSearchSelect
            inputId="c-vendor"
            value={vendor}
            onChange={setVendor}
            search={searchVendors}
            onStateChange={setVendorSearch}
            required
            invalid={Boolean(fieldErrors.vendor)}
            describedBy={fieldErrors.vendor ? "c-vendor-err" : undefined}
            labels={{
              placeholder: t("placeholder"), loading: t("loading"), empty: t("empty"),
              error: t("error"), retry: t("retry"), clear: t("clear"),
            }}
          />
          {fieldErrors.vendor ? <span id="c-vendor-err" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.vendor}</span> : null}
        </div>
        <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
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
          {fieldErrors.contractNo ? <span id="c-no-err" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.contractNo}</span> : null}
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "var(--panel)", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-title">Title *</label>
          <input id="c-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
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
          {fieldErrors.value ? <span id="c-val-err" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.value}</span> : null}
        </div>
        <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-po">PO reference</label>
          <input id="c-po" className="inp" value={poRef} onChange={(e) => setPoRef(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
          <label className="label" htmlFor="c-start">Start date *</label>
          <input id="c-start" type="date" className="inp" value={startDate} onChange={(e) => setStartDate(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
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
          {fieldErrors.expiry ? <span id="c-exp-err" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.expiry}</span> : null}
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "var(--bad)" : "var(--good)" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting" || (vendorSearch === "error" && !vendor)}>
          {status === "submitting" ? "Creating…" : "Create contract"}
        </Button>
        <Link href="/contracts/list" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
