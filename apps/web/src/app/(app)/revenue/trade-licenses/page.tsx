"use client";

/**
 * Trade Licenses page — list, create, renew and cancel municipal trade licenses.
 * Command writes are async (202); list is read from the revenue-service repo.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

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
  if (licenses.length === 0) {
    return <p style={{ color: "var(--ink2)", fontSize: 14, margin: 0 }}>No trade licenses found.</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--line)" }}>
            {["License No.", "Business", "Proprietor", "Type", "Cat.", "Status", "Expiry", "Fee (₹)", "Paid (₹)"].map((h) => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
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
                  className={`pill ${l.status === "active" ? "good" : l.status === "pending" ? "warn" : "bad"}`}
                  style={{ fontSize: 11 }}
                >
                  {l.status}
                </span>
              </td>
              <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{l.expiryDate ?? "—"}</td>
              <td style={{ padding: "8px 10px", textAlign: "right" }}>{(BigInt(l.feeMinor) / 100n).toString()}</td>
              <td style={{ padding: "8px 10px", textAlign: "right" }}>{(BigInt(l.feePaidMinor) / 100n).toString()}</td>
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
  const [feeMinor, setFeeMinor] = useState("0");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const licenseNoId = useId();
  const businessNameId = useId();
  const proprietorNameId = useId();
  const addressId = useId();
  const businessTypeId = useId();

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!licenseNo.trim()) next.licenseNo = "License No. is required.";
    if (!businessName.trim()) next.businessName = "Business name is required.";
    if (!proprietorName.trim()) next.proprietorName = "Proprietor name is required.";
    if (!address.trim()) next.address = "Address is required.";
    if (!businessType) next.businessType = "Select a business type.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setApiError(null);
    if (!validate()) return;
    setBusy(true);
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
          feeMinor: feeMinor.trim() || "0",
        }),
      });
      setMessage(`Trade license "${licenseNo.trim()}" submitted for registration.`);
      setLicenseNo(""); setBusinessName(""); setProprietorName("");
      setAddress(""); setWardNo(""); setBusinessType(""); setCategory("A"); setFeeMinor("0");
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
              <label htmlFor="tl-fee" style={labelStyle}>Fee (paise)</label>
              <input id="tl-fee" value={feeMinor} onChange={(e) => setFeeMinor(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric" style={inputStyle} />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              {busy ? "Submitting…" : "Issue Trade License"}
            </button>
          </div>

          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
          {apiError && <p role="alert" className="pill bad" style={{ width: "fit-content" }}>{apiError}</p>}
        </div>
      </Card>
    </form>
  );
}

// ── Page (Client Component — fetches on mount) ───────────────────────────────

import { useEffect } from "react";

export default function TradeLicensesPage() {
  const [licenses, setLicenses] = useState<TradeLicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  async function loadLicenses() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/revenue/trade-licenses");
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json() as { data?: TradeLicenseRow[] };
      const arr = Array.isArray(json) ? json : (json.data ?? []);
      setLicenses(arr);
      setFetchError(false);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadLicenses(); }, []);

  const activeCount = licenses.filter((l) => l.status === "active").length;
  const pendingCount = licenses.filter((l) => l.status === "pending").length;
  const expiredCount = licenses.filter((l) => l.status === "expired").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Trade Licenses"
        subtitle="Issue, renew, and cancel municipal trade and business licenses."
        back="/revenue"
      />

      <StatGrid>
        <StatCard icon="📜" iconBg="var(--panel)" label="Total Licenses" value={loading ? "…" : licenses.length} />
        <StatCard icon="✅" iconBg="var(--panel)" label="Active" value={loading ? "…" : activeCount} />
        <StatCard icon="⏳" iconBg="var(--panel)" label="Pending" value={loading ? "…" : pendingCount} />
        <StatCard icon="⚠️" iconBg="var(--panel)" label="Expired" value={loading ? "…" : expiredCount} />
      </StatGrid>

      <TradeLicenseCreateForm onCreated={loadLicenses} />

      <Card title="Trade Licenses">
        {loading ? (
          <div className="skeleton" aria-label="Loading licenses…" />
        ) : fetchError ? (
          <p role="alert" style={{ color: "var(--bad)", fontSize: 14, margin: 0 }}>
            Failed to load trade licenses. Please try again.
          </p>
        ) : (
          <TradeLicensesTable licenses={licenses} />
        )}
      </Card>
    </main>
  );
}
