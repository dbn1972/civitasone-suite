"use client";

/**
 * Trade Licenses page — issue and track municipal trade licenses.
 * Command writes are async (202); list is read from the revenue-service repo.
 *
 * NOTE (GAP-REVENUE-TRADE-LICENSES-03 decision): revenue-service DOES expose
 * renew (POST /:id/renew) and cancel (POST /:id/cancel) commands, but wiring
 * row actions for them is a maker-checker-sensitive follow-up tracked
 * separately. For now the page issues and tracks licences only, and the copy
 * no longer promises renew/cancel it does not yet surface.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, StatGrid, StatCard, Card, ErrorState, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { toHumanError } from "@/lib/messages";

// ── Types ────────────────────────────────────────────────────────────────────

export type TradeLicenseRow = {
  id: string;
  licenseNo: string;
  businessName: string;
  proprietorName: string;
  address: string;
  wardNo?: string | null;
  businessType: string;
  category: string;
  issuedDate?: string | null;
  expiryDate?: string | null;
  status: string;
  feeMinor: string;
  feePaidMinor: string;
  renewalCount: number;
  isActive: boolean;
};

// ── Table ────────────────────────────────────────────────────────────────────

function TradeLicensesTable({ licenses }: { licenses: TradeLicenseRow[] }) {
  if (licenses.length === 0) { // ux-001-ok: only rendered by the parent's `!loading && !fetchError` branch below -- a fetch failure never reaches this component
    return <p style={{ color: "var(--ink2)", fontSize: 14, margin: 0 }}>No trade licenses found.</p>;
  }
  // GAP-REVENUE-TRADE-LICENSES-05: map each known status to a distinct pill tone
  // so expired/cancelled/suspended no longer all look like a generic "bad".
  const pillClass = (status: string): string => {
    switch (status) {
      case "active":
        return "good";
      case "pending":
        return "warn";
      case "expired":
      case "suspended":
        return "warn";
      case "cancelled":
      case "rejected":
        return "bad";
      default:
        return "";
    }
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--line)" }}>
            {["License No.", "Business", "Proprietor", "Type", "Cat.", "Status", "Expiry", "Renewals", "Fee", "Paid"].map((h) => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "start", fontWeight: 600, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {licenses.map((l) => (
            <tr key={l.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "8px 10px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{l.licenseNo}</td>
              <td style={{ padding: "8px 10px" }}>{l.businessName}</td>
              <td style={{ padding: "8px 10px" }}>{l.proprietorName}</td>
              <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{l.businessType}</td>
              <td style={{ padding: "8px 10px" }}>{l.category}</td>
              <td style={{ padding: "8px 10px" }}>
                <span
                  className={`pill ${pillClass(l.status)}`}
                  style={{ fontSize: 11, textTransform: "capitalize" }}
                >
                  {l.status}
                </span>
              </td>
              <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{formatIndianDate(l.expiryDate)}</td>
              <td style={{ padding: "8px 10px", textAlign: "end" }} className="tabular-nums">{l.renewalCount}</td>
              <td style={{ padding: "8px 10px", textAlign: "end" }} className="tabular-nums">{formatMoney(l.feeMinor)}</td>
              <td style={{ padding: "8px 10px", textAlign: "end" }} className="tabular-nums">{formatMoney(l.feePaidMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Create Form ──────────────────────────────────────────────────────────────

type FieldErrors = {
  licenseNo?: string;
  businessName?: string;
  proprietorName?: string;
  address?: string;
  businessType?: string;
  fee?: string;
};

function TradeLicenseCreateForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();

  const [licenseNo, setLicenseNo] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [proprietorName, setProprietorName] = useState("");
  const [address, setAddress] = useState("");
  const [wardNo, setWardNo] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [category, setCategory] = useState("A");
  // GAP-REVENUE-TRADE-LICENSES-01: fee is entered in RUPEES (decimal), never
  // paise, and converted with rupeesToMinorString like every other revenue
  // money form. Default blank (not "0") so a clerk cannot silently issue a ₹0
  // licence by leaving the field untouched.
  const [feeRupees, setFeeRupees] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const licenseNoId = useId();
  const businessNameId = useId();
  const proprietorNameId = useId();
  const addressId = useId();
  const businessTypeId = useId();

  // Paise string the fee converts to, or null when blank/zero/invalid.
  const feeMinor = rupeesToMinorString(feeRupees);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!licenseNo.trim()) next.licenseNo = "License No. is required.";
    if (!businessName.trim()) next.businessName = "Business name is required.";
    if (!proprietorName.trim()) next.proprietorName = "Proprietor name is required.";
    if (!address.trim()) next.address = "Address is required.";
    if (!businessType) next.businessType = "Select a business type.";
    // GAP-REVENUE-TRADE-LICENSES-01 DECISION (safest default, flagged for
    // product): block ₹0 and malformed fees. Fee determines revenue, so an
    // accidental zero/empty is treated as an error rather than silently issuing
    // a free licence. Exempt categories, if any, are a future explicit opt-in.
    if (!feeMinor) next.fee = "Enter a fee greater than zero (e.g. 2500 or 2500.50).";
    setErrors(next);
    return Object.keys(next).length === 0; // ux-001-ok: client-side form-field validation result, not a loader empty-check
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setApiError(null);
    if (!validate()) return;
    setConfirmOpen(true);
  }

  async function submitCreate() {
    if (!feeMinor) return;
    setBusy(true);
    setApiError(null);
    try {
      await browserJson("v1/revenue/trade-licenses", {
        method: "POST",
        body: JSON.stringify({
          licenseNo: licenseNo.trim(),
          businessName: businessName.trim(),
          proprietorName: proprietorName.trim(),
          address: address.trim(),
          wardNo: wardNo.trim() || undefined,
          businessType,
          category,
          feeMinor,
        }),
      });
      setConfirmOpen(false);
      setMessage(`Trade license "${licenseNo.trim()}" submitted for registration.`);
      setLicenseNo(""); setBusinessName(""); setProprietorName("");
      setAddress(""); setWardNo(""); setBusinessType(""); setCategory("A"); setFeeRupees("");
      setErrors({});
      onCreated();
      router.refresh();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, width: "100%", boxSizing: "border-box" as const };
  const labelStyle = { fontSize: 13, fontWeight: 600 as const };
  const errStyle = { color: "var(--bad)", fontSize: 12, margin: 0 };
  const req = <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>;

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Issue New Trade License" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={licenseNoId} style={labelStyle}>License No. {req}</label>
              <input id={licenseNoId} value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} maxLength={64}
                aria-required="true" aria-invalid={!!errors.licenseNo || undefined} style={inputStyle} />
              {errors.licenseNo && <p role="alert" style={errStyle}>{errors.licenseNo}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={businessNameId} style={labelStyle}>Business Name {req}</label>
              <input id={businessNameId} value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={256}
                aria-required="true" aria-invalid={!!errors.businessName || undefined} style={inputStyle} />
              {errors.businessName && <p role="alert" style={errStyle}>{errors.businessName}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={proprietorNameId} style={labelStyle}>Proprietor Name {req}</label>
              <input id={proprietorNameId} value={proprietorName} onChange={(e) => setProprietorName(e.target.value)} maxLength={256}
                aria-required="true" aria-invalid={!!errors.proprietorName || undefined} style={inputStyle} />
              {errors.proprietorName && <p role="alert" style={errStyle}>{errors.proprietorName}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={addressId} style={labelStyle}>Address {req}</label>
              <input id={addressId} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500}
                aria-required="true" aria-invalid={!!errors.address || undefined} style={inputStyle} />
              {errors.address && <p role="alert" style={errStyle}>{errors.address}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="tl-ward" style={labelStyle}>Ward No.</label>
              <input id="tl-ward" value={wardNo} onChange={(e) => setWardNo(e.target.value)} maxLength={16} style={inputStyle} />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={businessTypeId} style={labelStyle}>Business Type {req}</label>
              <select id={businessTypeId} value={businessType} onChange={(e) => setBusinessType(e.target.value)}
                aria-required="true" aria-invalid={!!errors.businessType || undefined}
                style={{ ...inputStyle, appearance: "auto" }}>
                <option value="" disabled>Select a type…</option>
                <option value="retail">Retail</option>
                <option value="manufacturing">Manufacturing</option>
                <option value="service">Service</option>
                <option value="hawker">Hawker</option>
              </select>
              {errors.businessType && <p role="alert" style={errStyle}>{errors.businessType}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="tl-category" style={labelStyle}>Category</label>
              <select id="tl-category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, appearance: "auto" }}>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="tl-fee" style={labelStyle}>Fee (₹) {req}</label>
              <input id="tl-fee" value={feeRupees} onChange={(e) => setFeeRupees(e.target.value)}
                type="text" inputMode="decimal" placeholder="e.g. 2500.00"
                aria-required="true" aria-invalid={!!errors.fee || undefined} style={inputStyle} />
              {feeMinor && !errors.fee && (
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>= {formatMoney(feeMinor)}</p>
              )}
              {errors.fee && <p role="alert" style={errStyle}>{errors.fee}</p>}
            </div>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              {busy ? "Submitting…" : "Issue Trade License"}
            </Button>
          </div>

          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
          {apiError && <p role="alert" className="pill bad" style={{ width: "fit-content" }}>{apiError}</p>}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Issue this trade license?"
        confirmLabel="Issue license"
        busy={busy}
        errorMessage={apiError ?? undefined}
        description={
          feeMinor ? (
            <>
              Issue licence <strong className="mono">{licenseNo.trim()}</strong> to{" "}
              <strong>{businessName.trim()}</strong> with a fee of <strong>{formatMoney(feeMinor)}</strong>.
            </>
          ) : (
            "Issue this trade license?"
          )
        }
        onConfirm={() => void submitCreate()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

// ── Page (Client Component — fetches on mount) ───────────────────────────────

import { useEffect } from "react";
import { browserFetch } from "@/lib/api/browserClient";

export default function TradeLicensesPage() {
  const [licenses, setLicenses] = useState<TradeLicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  async function loadLicenses(signal?: AbortSignal) {
    setLoading(true);
    try {
      // GAP-REVENUE-TRADE-LICENSES-02: route the browser read through the BFF
      // proxy (/api/proxy/v1/...) like the create form (browserJson) and every
      // other client call, rather than hitting /api/v1 directly — only the proxy
      // attaches the httpOnly session, so a direct /api/v1 fetch is unauthenticated
      // and would 404/401 in the browser.
      const res = await browserFetch("v1/revenue/trade-licenses", { signal });
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json() as { data?: TradeLicenseRow[] };
      const arr = Array.isArray(json) ? json : (json.data ?? []);
      setLicenses(arr);
      setFetchError(false);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setFetchError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void loadLicenses(controller.signal)
    return () => controller.abort()
  }, []);

  const activeCount = licenses.filter((l) => l.status === "active").length;
  const pendingCount = licenses.filter((l) => l.status === "pending").length;
  const expiredCount = licenses.filter((l) => l.status === "expired").length;

  // GAP-REVENUE-TRADE-LICENSES-06: on a fetch failure show '—' (missing), not a
  // fabricated 0, in every KPI; only the loading state shows '…'.
  const kpi = (value: number): string | number => (fetchError ? "—" : loading ? "…" : value);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Trade Licenses"
        subtitle="Issue and track municipal trade and business licenses."
        back="/revenue"
      />

      <StatGrid>
        <StatCard icon="📜" iconBg="var(--panel)" label="Total Licenses" value={kpi(licenses.length)} />
        <StatCard icon="✅" iconBg="var(--panel)" label="Active" value={kpi(activeCount)} />
        <StatCard icon="⏳" iconBg="var(--panel)" label="Pending" value={kpi(pendingCount)} />
        <StatCard icon="⚠️" iconBg="var(--panel)" label="Expired" value={kpi(expiredCount)} />
      </StatGrid>

      <TradeLicenseCreateForm onCreated={loadLicenses} />

      <Card title="Trade Licenses">
        {loading ? (
          <div className="skeleton" aria-label="Loading licenses…" />
        ) : fetchError ? (
          <ErrorState
            error={toHumanError("load", { area: "trade licenses" })}
            onRetry={() => void loadLicenses()}
            backHref="/revenue"
          />
        ) : (
          <TradeLicensesTable licenses={licenses} />
        )}
      </Card>
    </div>
  );
}
