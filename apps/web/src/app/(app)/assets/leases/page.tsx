"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, PageHeader, DataTable, EmptyState, ErrorState, ConfirmDialog, Modal, SkeletonRow, useConfirmAction } from "../../../_components/ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { UserFacingError } from "@/lib/userFacingError";
import { glErrorKey, journalKey, journalState } from "../glStatus";
import { percentToBps, isDiscounted, parseSchedule, LEASE_FREQUENCIES, type LeaseFrequency, type LeaseScheduleRow } from "./leaseTerms";

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
  /** Set when the liability was discounted by the service (an amortisation schedule exists). */
  ibrBps?: number | null;
  /** Finance-side state of the recognition journal: none | pending | posted | failed. */
  glPostStatus?: string;
};

type Preview = { liabilityMinor: string; totalInterestMinor: string; periods: number };

const EMPTY_FORM = { leaseNo: "", lessorName: "", rouCost: "", liability: "", leaseStart: "", leaseEnd: "", ibr: "", payment: "" };

export default function LeasesPage() {
  const t = useTranslations("assetsGl");
  const [rows, setRows] = useState<Lease[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [frequency, setFrequency] = useState<LeaseFrequency>("monthly");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [repostTarget, setRepostTarget] = useState<Lease | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Lease | null>(null);
  const [schedule, setSchedule] = useState<LeaseScheduleRow[] | null>(null);
  const [scheduleState, setScheduleState] = useState<"loading" | "error" | "ok">("loading");

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

  // Amortisation schedule of one discounted lease (read-only modal).
  useEffect(() => {
    if (!scheduleFor) return;
    const controller = new AbortController();
    setScheduleState("loading");
    setSchedule(null);
    fetch(`/api/proxy/v1/asset/leases/${encodeURIComponent(scheduleFor.id)}/schedule`, { signal: controller.signal })
      .then(async (res) => {
        const parsed = res.ok ? parseSchedule(await res.json().catch(() => null)) : null;
        if (!parsed) { setScheduleState("error"); return; }
        setSchedule(parsed);
        setScheduleState("ok");
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setScheduleState("error");
      });
    return () => controller.abort();
  }, [scheduleFor]);

  // Money: rupees -> paise strings via rupeesToMinorString (never Number*100).
  const safe = (m: string | null) => (m !== null && Number.isSafeInteger(Number(m)) ? m : null);
  const rouMinor = safe(rupeesToMinorString(form.rouCost));
  const enteredLiabilityMinor = safe(rupeesToMinorString(form.liability));
  const discounted = isDiscounted(form.ibr, form.payment);
  const ibrBps = percentToBps(form.ibr);
  const paymentMinor = safe(rupeesToMinorString(form.payment));
  // Shown/confirmed liability: the service's present value when discounting, else what was typed.
  const liabilityMinor = discounted ? (preview?.liabilityMinor ?? null) : enteredLiabilityMinor;

  function validate(): string {
    if (!form.leaseNo.trim()) return "Enter the lease number.";
    if (!form.lessorName.trim()) return "Enter the lessor.";
    if (rouMinor === null) return "Enter a valid ROU cost in rupees (greater than zero, up to 2 decimals).";
    if (discounted) {
      if (ibrBps === null) return "Enter the discount rate (IBR) as a percentage, for example 8 or 8.5.";
      if (paymentMinor === null) return "Enter the periodic payment in rupees (greater than zero, up to 2 decimals).";
    } else if (enteredLiabilityMinor === null) {
      return "Enter a valid lease liability in rupees (greater than zero, up to 2 decimals).";
    }
    if (!form.leaseStart || !form.leaseEnd) return "Enter the lease start and end dates.";
    if (form.leaseEnd <= form.leaseStart) return "Lease end must be after the lease start.";
    return "";
  }

  function leaseBody(): Record<string, unknown> {
    return {
      leaseNo: form.leaseNo.trim(),
      lessorName: form.lessorName.trim(),
      rouCostMinor: Number(rouMinor),
      leaseStart: form.leaseStart,
      leaseEnd: form.leaseEnd,
      ...(discounted
        ? { ibrBps, paymentMinor: Number(paymentMinor), paymentFrequency: frequency }
        : { liabilityMinor: Number(enteredLiabilityMinor) }),
    };
  }

  // GAP-ASSETS-LEASES-01: registering a lease creates an ROU asset and a lease
  // liability, so it is confirmed first; the POST happens only on Confirm.
  const register = useConfirmAction({
    onConfirm: async () => {
      if (rouMinor === null) throw new Error("Complete the form first.");
      setMessage("");
      const leaseNo = form.leaseNo.trim();
      const res = await fetch("/api/proxy/v1/asset/leases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(leaseBody()),
      });
      if (!res.ok) {
        // GL-heads errors are translated (en + hi); anything else is the standard copy, never the raw response body.
        const gl = glErrorKey(await errorCodeFromResponse(res));
        throw gl ? new UserFacingError(t(gl)) : await userFacingErrorFromResponse(res, "save", "lease");
      }
      setMessage(`Lease ${leaseNo} submitted. Its ROU asset ROU/${leaseNo} and lease liability will appear shortly.`);
      setForm(EMPTY_FORM);
      setPreview(null);
      await load();
    },
  });

  // Repost a journal Finance did not post (asset_admin only -- the service answers 403 otherwise). Nothing is sent before Confirm.
  const repost = useConfirmAction({
    onConfirm: async () => {
      if (!repostTarget) return;
      const res = await fetch(`/api/proxy/v1/asset/leases/${encodeURIComponent(repostTarget.id)}/journal/repost`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      if (!res.ok) {
        const gl = glErrorKey(await errorCodeFromResponse(res));
        throw new Error(gl ? t(gl) : await errorMessageFromResponse(res, "save", "lease journal"));
      }
      setMessage(t("repostDone"));
      await load();
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    setFormError(err);
    if (err) return;
    if (discounted) {
      // The liability is the present value of the payments, computed by the service so the figure
      // confirmed here is exactly the one that gets recorded.
      setPreview(null);
      const res = await fetch("/api/proxy/v1/asset/leases/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(leaseBody()),
      }).catch(() => null);
      if (!res || !res.ok) {
        const code = res ? await errorCodeFromResponse(res) : null;
        setFormError(code === "INVALID_LEASE_TERMS"
          ? "These lease terms cannot be scheduled. Check the dates, the payment and the discount rate."
          : "Couldn't calculate the lease liability. Please try again.");
        return;
      }
      const body = (await res.json().catch(() => null)) as Preview | null;
      if (!body || !/^\d+$/.test(body.liabilityMinor)) {
        setFormError("Couldn't calculate the lease liability. Please try again.");
        return;
      }
      setPreview(body);
    }
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
    hasSchedule: typeof r.ibrBps === "number",
    journal: journalState(r.glPostStatus),
  }));

  return (
    <>
      <PageHeader
        title="Leases"
        subtitle="Right-of-use assets and lease liability tracking (Ind AS 116)."
        back="/assets"
        backLabel="Assets"
        actions={<Link href="/assets/settings" className="btn ghost">{t("settingsLink")}</Link>}
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "var(--panel)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={(e) => void submit(e)} noValidate className="pad">
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
              <input
                id="lease-liab"
                required={!discounted}
                disabled={discounted}
                inputMode="decimal"
                aria-describedby="lease-liab-hint"
                value={discounted ? "" : form.liability}
                placeholder={discounted ? "Calculated" : undefined}
                onChange={(e) => setForm({ ...form, liability: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-start">Lease start</label>
              <input id="lease-start" required type="date" value={form.leaseStart} onChange={(e) => setForm({ ...form, leaseStart: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-end">Lease end</label>
              <input id="lease-end" required type="date" min={form.leaseStart || undefined} value={form.leaseEnd} onChange={(e) => setForm({ ...form, leaseEnd: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-ibr">Discount rate / IBR (% a year)</label>
              <input id="lease-ibr" inputMode="decimal" placeholder="Optional, e.g. 8.5" value={form.ibr} onChange={(e) => setForm({ ...form, ibr: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-payment">Periodic payment (₹)</label>
              <input id="lease-payment" inputMode="decimal" placeholder="Optional" value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="lease-frequency">Payment frequency</label>
              <select id="lease-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as LeaseFrequency)} style={inputStyle}>
                {LEASE_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <p id="lease-money-hint" style={{ fontSize: 12, color: "var(--ink2)", margin: "8px 0 0" }}>
            Enter amounts as digits only, with up to 2 decimals (for example 18500000 or 185000.50) — no commas.
          </p>
          <p id="lease-liab-hint" style={{ fontSize: 12, color: "var(--ink2)", margin: "4px 0 0" }}>
            To have the liability discounted and a repayment schedule created, enter the discount rate and the periodic payment (payments are assumed at the end of each period); the liability is then the present value of the payments.
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
            <EmptyState icon="📄" title="No leases yet" message="Register a lease to track ROU assets and liabilities." />
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
                // What finance did with the recognition journal: a lease never reads as recognised when its journal failed.
                key: "journal",
                label: t("journal"),
                render: (r) =>
                  r.journal === "none" ? (
                    <span style={{ color: "var(--ink2)", fontSize: 13 }}>{t("journalNone")}</span>
                  ) : (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span className={`pill ${r.journal === "posted" ? "good" : r.journal === "failed" ? "bad" : "warn"}`}>{t(journalKey(r.journal))}</span>
                      {r.journal === "failed" ? (
                        <Button type="button" variant="ghost" aria-label={`${t("repostJournal")}: ${r.leaseNo}`} onClick={() => { setRepostTarget(rows.find((x) => x.id === r.id) ?? null); repost.trigger(); }}>
                          {t("repostJournal")}
                        </Button>
                      ) : null}
                    </span>
                  ),
              },
              {
                key: "hasSchedule",
                label: "Schedule",
                render: (r) =>
                  r.hasSchedule ? (
                    <Button type="button" variant="ghost" aria-label={`View repayment schedule for lease ${r.leaseNo}`} onClick={() => setScheduleFor(rows.find((x) => x.id === r.id) ?? null)}>
                      View
                    </Button>
                  ) : (
                    "—"
                  ),
              },
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
        title="Register this lease?"
        description={
          <>
            Lease <b>{form.leaseNo.trim()}</b> with <b>{form.lessorName.trim()}</b>, {formatIndianDate(form.leaseStart)} to{" "}
            {formatIndianDate(form.leaseEnd)}: creates a right-of-use asset of <b>{formatMoney(rouMinor)}</b> and a lease
            liability of <b>{formatMoney(liabilityMinor)}</b>
            {discounted && preview ? <> (present value of {preview.periods} {frequency} payments at {form.ibr.trim()}% a year; total interest {formatMoney(preview.totalInterestMinor)})</> : null}.
          </>
        }
        confirmLabel="Register lease"
        busy={register.busy}
        errorMessage={register.error}
        onConfirm={register.confirm}
        onCancel={register.cancel}
      />
      <ConfirmDialog
        open={repost.open}
        title={t("repostTitle")}
        description={<>{t("repostDescription")}</>}
        confirmLabel={t("repostConfirm")}
        busy={repost.busy}
        errorMessage={repost.error}
        onConfirm={repost.confirm}
        onCancel={repost.cancel}
      />
      <Modal open={scheduleFor !== null} onClose={() => setScheduleFor(null)} title={scheduleFor ? `Repayment schedule — lease ${scheduleFor.leaseNo}` : "Repayment schedule"} size="lg">
        {scheduleState === "loading" ? (
          <div aria-busy="true" aria-label="Loading schedule">{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>
        ) : scheduleState === "error" ? (
          <ErrorState error={toHumanError("load", { area: "repayment schedule" })} onRetry={() => setScheduleFor(scheduleFor ? { ...scheduleFor } : null)} />
        ) : schedule && schedule.length > 0 ? (
          <div style={{ maxHeight: 360, overflow: "auto" }}>
            <table className="tbl" style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th scope="col">#</th><th scope="col">Due</th>
                  <th scope="col" style={{ textAlign: "right" }}>Opening</th><th scope="col" style={{ textAlign: "right" }}>Interest</th>
                  <th scope="col" style={{ textAlign: "right" }}>Payment</th><th scope="col" style={{ textAlign: "right" }}>Principal</th>
                  <th scope="col" style={{ textAlign: "right" }}>Closing</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((r) => (
                  <tr key={r.seq}>
                    <td>{r.seq}</td><td>{formatIndianDate(r.dueDate)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(r.openingMinor)}</td><td style={{ textAlign: "right" }}>{formatMoney(r.interestMinor)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(r.paymentMinor)}</td><td style={{ textAlign: "right" }}>{formatMoney(r.principalMinor)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(r.closingMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="📄" title="No schedule rows" message="This lease has no repayment schedule yet. It appears shortly after the lease is processed." />
        )}
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <Button type="button" variant="ghost" onClick={() => setScheduleFor(null)}>Close</Button>
        </div>
      </Modal>
    </>
  );
}
