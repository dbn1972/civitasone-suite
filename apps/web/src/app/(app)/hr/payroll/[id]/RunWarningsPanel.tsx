"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { toHumanError } from "@/lib/messages";
import { employeeEditHref, isKnownWarningCode, parseRunWarnings, warningLinksToEmployees, type RunWarning } from "./runWarnings";

type State = { phase: "loading" } | { phase: "error" } | { phase: "ready"; warnings: RunWarning[] };

/**
 * Warnings the run engine recorded for this run (PT state / gender unknown, HRA floor not configured).
 * Loads on its own so a failure here never hides the rest of the run, with distinct loading, error and
 * empty states. Each employee-specific warning links to the affected employees' edit pages.
 */
export function RunWarningsPanel({ runId }: { runId: string }) {
  const t = useTranslations("runWarnings");
  const [state, setState] = useState<State>({ phase: "loading" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await browserFetch(`v1/payroll/runs/${encodeURIComponent(runId)}/warnings`);
      if (!res.ok) { setState({ phase: "error" }); return; }
      const warnings = parseRunWarnings(await res.json());
      setState(warnings ? { phase: "ready", warnings } : { phase: "error" });
    } catch {
      setState({ phase: "error" });
    }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);

  const err = toHumanError("load", { area: t("loadArea") });

  return (
    <Card title={t("title")}>
      <div className="pad" style={{ display: "grid", gap: 10 }}>
        {state.phase === "loading" && <p role="status" aria-live="polite" style={{ margin: 0, color: "var(--mut)" }}>{t("loading")}</p>}
        {state.phase === "error" && (
          <div role="alert" style={{ display: "grid", gap: 6 }}>
            <strong>{err.what}</strong>
            <span>{err.next}</span>
            <button type="button" className="btn ghost sm" style={{ width: "fit-content", minHeight: 44 }} onClick={() => void load()}>{t("retry")}</button>
          </div>
        )}
        {state.phase === "ready" && state.warnings.length === 0 && <p role="status" style={{ margin: 0, color: "var(--mut)" }}>{t("none")}</p>}
        {state.phase === "ready" && state.warnings.map((w) => (
          <section key={w.code} aria-label={isKnownWarningCode(w.code) ? t(`${w.code}.title`) : t("unknown.title")}
            style={{ border: "1.5px solid var(--warn, #d97706)", borderRadius: 10, background: "var(--warnbg, #fffbeb)", padding: "10px 14px", display: "grid", gap: 6 }}>
            <strong>{isKnownWarningCode(w.code) ? t(`${w.code}.title`) : t("unknown.title")}</strong>
            <span style={{ fontSize: 13 }}>
              {isKnownWarningCode(w.code) ? t(`${w.code}.body`, { count: w.count }) : t("unknown.body", { code: w.code, count: w.count })}
            </span>
            {warningLinksToEmployees(w.code) && w.sample.length > 0 && (
              <div style={{ fontSize: 13 }}>
                <span>{t("affectedEmployees", { shown: w.sample.length, count: w.count })}</span>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "flex", flexWrap: "wrap", gap: "4px 16px", listStyle: "none" }}>
                  {w.sample.map((e) => (
                    <li key={e.employeeId}><Link href={employeeEditHref(e.employeeId)}>{t("fixEmployee", { no: e.employeeNo })}</Link></li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}
