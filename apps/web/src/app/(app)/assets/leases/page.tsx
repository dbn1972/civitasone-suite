"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, PageHeader, DataTable, EmptyState, ErrorState, ConfirmDialog, SkeletonRow, useConfirmAction } from "../../../_components/ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

type Lease = {
  id: string;
  leaseNo: string;
  lessorName: string;
  rouCostMinor: number | string;
  liabilityMinor: number | string;
  leaseStart: string;
  leaseEnd: string;
  assetId?: string | null;
  status: string;
};

export default function LeasesPage() {
  const [rows, setRows] = useState<Lease[]>([]);
  const [form, setForm] = useState({ leaseNo: "", lessorName: "", rouCost: "", liability: "", leaseStart: "", leaseEnd: "" });
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  async function load(signal?: AbortSignal) {
    try {
      const res = await fetch("/api/proxy/v1/asset/leases", { signal });
      setLoaded(true);
      if (!res.ok) {
        // UX-013: a failed fetch used to fall through to the same "No
        // leases yet" empty state as a genuinely empty register.
        setLoadError(true);
        return;
      }
      const body = await res.json() as { data: Lease[] };
      setRows(body.data ?? []);
      setLoadError(false);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setLoaded(true);
        setLoadError(true);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, []);

  // Money: rupees -> paise strings via rupeesToMinorString (never Number*100).
  const safe = (m: string | null) => (m !== null && Number.isSafeInteger(Number(m)) ? m : null);
  const rouMinor = safe(rupeesToMinorString(form.rouCost));
  const liabilityMinor = safe(rupeesToMinorString(form.liability));

  function validate(): string {
    if (!form.leaseNo.trim()) return "Enter the lease number.";
    if (!form.lessorName.trim()) return "Enter the lessor.";
    if (rouMinor === null) return "Enter a valid ROU cost in rupees (greater than zero, up to 2 decimals).";
    if (liabilityMinor === null) return "Enter a valid lease liability in rupees (greater than zero, up to 2 decimals).";
    if (!form.leaseStart || !form.leaseEnd) return "Enter the lease start and end dates.";
    if (form.leaseEnd <= form.leaseStart) return "Lease end must be after the lease start.";
    return "";
  }

  // GAP-ASSETS-LEASES-01: registering a lease creates an ROU asset and a lease
  // liability, so it is confirmed first; the POST happens only on Confirm.
  const register = useConfirmAction({
    onConfirm: async () => {
      if (rouMinor === null || liabilityMinor === null) throw new Error("Complete the form first.");
      setMessage("");
      const leaseNo = form.leaseNo.trim();
      const res = await fetch("/api/proxy/v1/asset/leases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseNo,
          lessorName: form.lessorName.trim(),
          rouCostMinor: Number(rouMinor),
          liabilityMinor: Number(liabilityMinor),
          leaseStart: form.leaseStart,
          leaseEnd: form.leaseEnd,
        }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setMessage(`Lease ${leaseNo} submitted. Its ROU asset ROU/${leaseNo} and lease liability will appear shortly.`);
      setForm({ leaseNo: "", lessorName: "", rouCost: "", liability: "", leaseStart: "", leaseEnd: "" });
      await load();
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    setFormError(err);
    if (err) return;
    register.trigger();
  }

  const inputStyle = { padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
  const fieldCol = { display: "flex", flexDirection: "column" as const, gap: 4 };

  // GAP-ASSETS-LEASES-02: liability and status are captured and returned, so they are shown.
  const tableRows = rows.map((r) => ({
    id: r.id,
    leaseNo: r.leaseNo,
    lessorName: r.lessorName,
    rou: formatMoney(r.rouCostMinor),
    liability: formatMoney(r.liabilityMinor),
    status: r.status,
    term: `${formatIndianDate(r.leaseStart)} → ${formatIndianDate(r.leaseEnd)}`,
    assetId: r.assetId ?? "",
  }));

  return (
    <>
      <PageHeader
        title="IFRS 16 Leases"
        subtitle="Right-of-use assets and lease liability tracking."
        back="/assets"
        backLabel="Assets"
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "var(--panel)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={submit} noValidate className="pad">
          <div className="fields">
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-no">Lease no.</label>
              <input id="lease-no" required value={form.leaseNo} onChange={(e) => setForm({ ...form, leaseNo: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-lessor">Lessor</label>
              <input id="lease-lessor" required value={form.lessorName} onChange={(e) => setForm({ ...form, lessorName: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-rou">ROU cost (₹)</label>
              <input id="lease-rou" required inputMode="decimal" aria-describedby="lease-money-hint" value={form.rouCost} onChange={(e) => setForm({ ...form, rouCost: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-liab">Liability (₹)</label>
              <input id="lease-liab" required inputMode="decimal" value={form.liability} onChange={(e) => setForm({ ...form, liability: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-start">Lease start</label>
              <input id="lease-start" required type="date" value={form.leaseStart} onChange={(e) => setForm({ ...form, leaseStart: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-end">Lease end</label>
              <input id="lease-end" required type="date" min={form.leaseStart || undefined} value={form.leaseEnd} onChange={(e) => setForm({ ...form, leaseEnd: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <p id="lease-money-hint" style={{ fontSize: 12, color: "var(--ink2)", margin: "8px 0 0" }}>
            Enter amounts as digits only, with up to 2 decimals (for example 18500000 or 185000.50) — no commas.
          </p>
          {formError ? <p role="alert" style={{ color: "var(--bad)", fontSize: 12, margin: "8px 0 0" }}>{formError}</p> : null}
          <Button type="submit" disabled={register.busy} style={{ marginTop: 12 }}>{register.busy ? "Registering…" : "Register lease"}</Button>
        </form>
      </div>
      <div className="card">
        <div className="card-h"><h3>Active leases</h3></div>
        {loadError ? (
          <ErrorState error={toHumanError("load", { area: "leases" })} onRetry={() => void load()} />
        ) : tableRows.length === 0 ? (
          loaded ? (
            <EmptyState icon="📄" title="No leases yet" message="Register an IFRS 16 lease to track ROU assets and liabilities." />
          ) : (
            <div aria-busy="true" aria-label="Loading leases">
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          )
        ) : (
          <DataTable
            columns={[
              { key: "leaseNo", label: "Lease" },
              { key: "lessorName", label: "Lessor" },
              { key: "rou", label: "ROU", align: "right" },
              { key: "liability", label: "Liability", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "term", label: "Term" },
              {
                key: "assetId",
                label: "Asset",
                // GAP-ASSETS-LEASES-06: client-side navigation, distinguishable accessible name.
                render: (r) =>
                  r.assetId ? (
                    <Link href={`/assets/${encodeURIComponent(r.assetId)}`} aria-label={`View asset for lease ${r.leaseNo}`}>
                      View
                    </Link>
                  ) : (
                    "—"
                  ),
              },
            ]}
            rows={tableRows}
            sortable
            filterable
            filterPlaceholder="Filter by lease or lessor…"
            pageSize={15}
          />
        )}
      </div>
      <ConfirmDialog
        open={register.open}
        title="Register this IFRS 16 lease?"
        description={
          <>
            Lease <b>{form.leaseNo.trim()}</b> with <b>{form.lessorName.trim()}</b>, {formatIndianDate(form.leaseStart)} to{" "}
            {formatIndianDate(form.leaseEnd)}: creates a right-of-use asset of <b>{formatMoney(rouMinor)}</b> and a lease
            liability of <b>{formatMoney(liabilityMinor)}</b>.
          </>
        }
        confirmLabel="Register lease"
        busy={register.busy}
        errorMessage={register.error}
        onConfirm={register.confirm}
        onCancel={register.cancel}
      />
    </>
  );
}
