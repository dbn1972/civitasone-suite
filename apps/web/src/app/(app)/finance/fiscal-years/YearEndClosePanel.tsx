"use client";

/**
 * fx-p3: the 31 March year-end close (finance-service GET /v1/finance/year-end/:fy and
 * POST /v1/finance/year-end/:fy/close, finance_admin / super_admin). The close records the lapse statement
 * (GFR: unspent provision lapses, it is not carried forward) and generates the next year opening balances for
 * the carry-forward heads only. The server makes it safe to run again; this panel shows the recorded status and
 * asks for a reason. Refusals (FY_OPEN_PERIODS, OPENING_BALANCES_MANUAL) are worded by the error catalogue.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Button, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatIndianDateTime, formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { formatClosedBy } from "../period-close/periodHelpers";

export type YearEndStatus = {
  fiscalYear: string;
  nextFiscalYear: string;
  status: "not_run" | "done";
  runAt: string | null;
  runBy: string | null;
  openingBalanceCount: number;
  lapseTotalMinor: string;
  fundCarriedMinor: string;
};

const MINOR_RE = /^-?\d+$/;

/** The status body, bare or wrapped in `data`; null when it is not the documented shape. */
export function parseYearEndStatus(body: unknown): YearEndStatus | null {
  const outer = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  if (!outer) return null;
  const d = (typeof outer.data === "object" && outer.data !== null ? outer.data : outer) as Record<string, unknown>;
  if (typeof d.fiscalYear !== "string" || typeof d.nextFiscalYear !== "string") return null;
  if (d.status !== "not_run" && d.status !== "done") return null;
  const minor = (v: unknown) => (typeof v === "string" && MINOR_RE.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : "0");
  return {
    fiscalYear: d.fiscalYear,
    nextFiscalYear: d.nextFiscalYear,
    status: d.status,
    runAt: typeof d.runAt === "string" ? d.runAt : null,
    runBy: typeof d.runBy === "string" && d.runBy.trim() ? d.runBy : null,
    openingBalanceCount: typeof d.openingBalanceCount === "number" && Number.isFinite(d.openingBalanceCount) ? d.openingBalanceCount : 0,
    lapseTotalMinor: minor(d.lapseTotalMinor),
    fundCarriedMinor: minor(d.fundCarriedMinor),
  };
}

export function YearEndClosePanel({ years, defaultFy, canRun }: { years: string[]; defaultFy?: string; canRun: boolean }) {
  const t = useTranslations("financeYearEnd");
  const [fy, setFy] = useState(defaultFy && years.includes(defaultFy) ? defaultFy : years[0] ?? "");
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [status, setStatus] = useState<YearEndStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (year: string, signal?: { active: boolean }) => {
    setState("loading");
    try {
      const res = await browserFetch(`v1/finance/year-end/${encodeURIComponent(year)}`);
      const parsed = res.ok ? parseYearEndStatus(await res.json()) : null;
      if (signal && !signal.active) return;
      setStatus(parsed);
      setState(parsed ? "ready" : "error");
    } catch {
      if (!signal || signal.active) setState("error");
    }
  }, []);

  useEffect(() => {
    if (!fy) return;
    const signal = { active: true };
    void load(fy, signal);
    return () => { signal.active = false; };
  }, [fy, load]);

  async function run(reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserFetch(`v1/finance/year-end/${encodeURIComponent(fy)}/close`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setDialogError(await errorMessageFromResponse(res, "save", t("area")));
        return;
      }
      setOpen(false);
      setMessage(t("accepted", { fy }));
      void load(fy);
    } catch {
      const human = toHumanError("save", { area: t("area") });
      setDialogError(`${human.what} ${human.next}`);
    } finally {
      setBusy(false);
    }
  }

  const ready = state === "ready" && status !== null;
  const runBy = status?.runBy ? formatClosedBy(status.runBy, null).text : t("byUnknown");

  return (
    <Card title={t("title")}>
      <div className="pad" style={{ display: "grid", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13.5 }}>{t("intro")}</p>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--mut)" }}>{t("rerun")}</p>
        <label style={{ display: "grid", gap: 4, maxWidth: 260, fontSize: 13 }}>
          <span>{t("fyLabel")}</span>
          <select
            className="input"
            value={fy}
            onChange={(e) => { setMessage(null); setFy(e.target.value); }}
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

        <div aria-live="polite">
          {state === "loading" ? <p style={{ margin: 0, fontSize: 13 }}>{t("loading")}</p> : null}
          {state === "error" ? (
            <div role="alert" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "var(--bad)", fontSize: 13 }}>{t("loadError")}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void load(fy)}>{t("retry")}</Button>
            </div>
          ) : null}
          {ready && status ? (
            <>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
                {status.status === "done"
                  ? t("statusDone", { fy: status.fiscalYear, at: status.runAt ? formatIndianDateTime(status.runAt) : "—", by: runBy })
                  : t("statusNotRun", { fy: status.fiscalYear })}
              </p>
              {status.status === "done" ? (
                <dl style={{ display: "grid", gridTemplateColumns: "max-content auto", gap: "4px 16px", margin: 0, fontSize: 13 }}>
                  <dt>{t("openingBalances", { next: status.nextFiscalYear })}</dt>
                  <dd style={{ margin: 0 }}>{status.openingBalanceCount}</dd>
                  <dt>{t("lapseTotal")}</dt>
                  <dd style={{ margin: 0 }}>{formatMoney(status.lapseTotalMinor)}</dd>
                  <dt>{t("fundCarried")}</dt>
                  <dd style={{ margin: 0 }}>{formatMoney(status.fundCarriedMinor)}</dd>
                </dl>
              ) : null}
            </>
          ) : null}
        </div>

        {canRun ? (
          ready ? (
            <div>
              <Button type="button" variant="primary" onClick={() => { setDialogError(undefined); setOpen(true); }}>
                {status?.status === "done" ? t("runAgain") : t("run")}
              </Button>
            </div>
          ) : null
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("adminOnly")}</p>
        )}
        {message ? <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p> : null}
      </div>

      <ConfirmDialog
        open={open}
        title={t("confirmTitle", { fy })}
        description={status ? t("confirmDescription", { fy, next: status.nextFiscalYear }) : undefined}
        confirmLabel={t("run")}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={10}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={(reason) => void run(reason)}
        onCancel={() => !busy && setOpen(false)}
      />
    </Card>
  );
}
