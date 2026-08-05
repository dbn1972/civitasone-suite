"use client";
/**
 * OnboardingList — P1-9. Lists customer onboarding cases with a stage filter.
 * Every read is gated on source==="error": on a failed load we render the
 * saved-info badge and an explicit "couldn't load" row, never a fabricated
 * empty list as fact. Status is shown as icon+label (not colour-only).
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { EmptyState } from "../../../_components/ds";
import {
  getOnboardingCases,
  ONBOARDING_STAGES,
  STAGE_LABELS,
  STAGE_META,
  KYC_META,
  kycLabel,
  stageLabel,
  type OnboardingCase,
  type OnboardingStage,
  type OnbSource,
} from "@/lib/crm/onboarding";

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN");
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id || "—";
}

export function OnboardingList() {
  const [stage, setStage] = useState<OnboardingStage | "">("");
  const [cases, setCases] = useState<OnboardingCase[]>([]);
  const [source, setSource] = useState<OnbSource | "loading">("loading");
  const filterId = useId();

  useEffect(() => {
    let alive = true;
    setSource("loading");
    void getOnboardingCases(stage ? { stage } : {}).then(({ data, source: s }) => {
      if (!alive) return;
      setCases(data);
      setSource(s);
    });
    return () => {
      alive = false;
    };
  }, [stage]);

  const isError = source === "error";
  const isLoading = source === "loading";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label htmlFor={filterId} style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
          Stage
        </label>
        <select
          id={filterId}
          value={stage}
          onChange={(e) => setStage(e.target.value as OnboardingStage | "")}
          style={{ padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
        >
          <option value="">All stages</option>
          {ONBOARDING_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Onboarding cases</h3>
        </div>
        {isLoading ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
            Loading cases…
          </p>
        ) : isError ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
            — Onboarding cases couldn&apos;t be loaded right now. <DataSourceBadge source="error" />
          </p>
        ) : cases.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No onboarding cases"
            message={stage ? `No cases in the "${STAGE_LABELS[stage as OnboardingStage]}" stage.` : "Cases appear here once a deal is won."}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Case</th>
                <th>Stage</th>
                <th>KYC</th>
                <th>Account</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const sm = STAGE_META[c.stage as OnboardingStage];
                const km = KYC_META[c.kycStatus as keyof typeof KYC_META];
                return (
                  <tr key={c.id}>
                    <td>
                      <a href={`/crm/onboarding/${c.id}`}>{shortId(c.id)}</a>
                    </td>
                    <td>
                      <span aria-hidden="true">{sm ? sm.icon : "•"}</span> {stageLabel(c.stage)}
                    </td>
                    <td>
                      <span aria-hidden="true">{km ? km.icon : "•"}</span> {kycLabel(c.kycStatus)}
                    </td>
                    <td style={{ fontSize: 13 }}>{c.accountId ? shortId(c.accountId) : "—"}</td>
                    <td style={{ fontSize: 13 }}>{fmtDate(c.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
